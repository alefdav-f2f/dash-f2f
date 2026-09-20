import 'server-only';

// Site Health é o diagnóstico nativo do WordPress core (Ferramentas > Saúde do
// site). Ele já sabe checar as coisas que fazem um site parar de se cuidar
// sozinho: se as atualizações automáticas rodam, se o WP-Cron consegue fazer
// loopback, se o site enxerga o wordpress.org, se o cabeçalho Authorization
// chega ao PHP. Em vez de reimplementar essas checagens, lemos o veredito que
// o próprio core já calculou.
//
// REGRA DE OURO: uma checagem que falhou (rede caiu, JSON inválido, 403, rota
// não encontrada) vira 'unknown' — nunca 'good'. 'good' só pode vir de o
// WordPress ter dito 'good'. Inventar um "provavelmente está tudo bem" a
// partir de um erro de rede é exatamente o tipo de afirmação que os dados não
// sustentam.
//
// Pelo mesmo motivo, fetchSiteHealth sempre devolve os seis resultados, um
// por teste, mesmo quando tudo falha. Uma lista vazia pareceria "não há nada
// de errado"; um teste ausente desapareceria silenciosamente da UI. Os dois
// são piores que devolver seis 'unknown' explícitos.

import { wpGet } from './wp-rest';
import type { Credential } from './wp-rest';
import type { HealthCheck, HealthStatus } from './types';

/** Os seis testes do Site Health, pelo slug usado na URL da REST API. */
export const HEALTH_TESTS = [
  'authorization-header',
  'background-updates',
  'dotorg-communication',
  'https-status',
  'loopback-requests',
  'page-cache',
] as const;

// Achado rodando contra um WordPress real (fixture PHP dev server, mas o
// problema de fundo não é do fixture): as seis checagens rodavam em paralelo
// contra TIMEOUT_MS de wp-rest.ts (12s), pensado para "ler uma lista JSON".
// Três delas fazem I/O de rede de verdade no servidor:
//   - https-status: o core do WordPress abre uma conexão HTTPS para o próprio
//     host. Num site que só serve HTTP, isso é um TCP connect que nunca
//     completa — estruturalmente mais lento que 12s, às vezes mais que 20s.
//   - loopback-requests e page-cache: cada uma dispara uma sub-requisição HTTP
//     de volta para o próprio site. Rodando ao mesmo tempo que as outras cinco
//     checagens (mais themes/users/settings de collectInventory), essa
//     sub-requisição entra na mesma fila de conexões que nós mesmos estamos
//     ocupando e morre de fome — starvation, não lentidão do WordPress.
//
// A correção tem três partes:
//  1. Sequencial, não Promise.all: além de eliminar a fome (não competimos
//     mais com a nossa própria sub-requisição), é a postura correta para um
//     painel de monitoramento — disparar seis requisições diagnósticas de
//     uma vez contra o site de PRODUÇÃO de um cliente é falta de educação,
//     ainda que o servidor aguente.
//  2. Timeout por checagem maior (HEALTH_TIMEOUT_MS): essas checagens fazem
//     I/O de rede de verdade do lado do servidor, diferente de "ler uma lista
//     de plugins". 12s calibrado para leitura de inventário é curto demais.
//  3. Orçamento total (HEALTH_BUDGET_MS): seis checagens de 20s cada, na pior
//     hipótese, seriam 120s só de Site Health — e o cron varre até 4 sites
//     concorrentes dentro de um maxDuration de 300s. O orçamento garante que
//     Site Health não devora o tempo do resto da varredura; o que sobrar sem
//     tempo vira 'unknown' explícito (ver REGRA DE OURO acima), nunca é
//     omitido da lista.
const HEALTH_TIMEOUT_MS = 20_000;
const HEALTH_BUDGET_MS = 45_000;

/** Opções para teste: sobrescrever timeout, orçamento e o relógio. */
export type FetchSiteHealthOptions = {
  timeoutMs?: number;
  budgetMs?: number;
  now?: () => number;
};

const KNOWN_STATUSES: readonly HealthStatus[] = ['good', 'recommended', 'critical'];

function isKnownStatus(value: unknown): value is HealthStatus {
  return typeof value === 'string' && (KNOWN_STATUSES as readonly string[]).includes(value);
}

/**
 * Normaliza a resposta crua de `/wp-site-health/v1/tests/<test>`.
 *
 * `test` é o slug da URL que pedimos, não o campo `test` do corpo — o corpo
 * usa underscore (`dotorg_communication`) e nós indexamos por hífen
 * (`dotorg-communication`, a chave que vamos usar para persistir e para casar
 * com a URL). Qualquer status fora do vocabulário conhecido do core vira
 * 'unknown', o mesmo destino de uma resposta ausente ou malformada.
 */
export function normalizeHealth(test: string, raw: unknown): HealthCheck {
  const body = (raw ?? {}) as Record<string, unknown>;
  const status = isKnownStatus(body.status) ? body.status : 'unknown';
  const label = typeof body.label === 'string' ? body.label : '';
  const badgeRaw = body.badge;
  const badge =
    badgeRaw && typeof badgeRaw === 'object' && typeof (badgeRaw as Record<string, unknown>).label === 'string'
      ? String((badgeRaw as Record<string, unknown>).label)
      : '';

  return { test, status, label, badge };
}

/**
 * Roda os seis testes de Site Health um de cada vez (ver comentário acima
 * sobre por que sequencial, por que um timeout maior e por que um
 * orçamento). Cada um continua isolado: a falha de um (rede, timeout, 403,
 * 404, JSON inválido) não derruba os outros nem reduz o tamanho da lista —
 * ela sempre tem `HEALTH_TESTS.length` itens, mesmo quando o orçamento
 * acaba no meio do caminho.
 */
export async function fetchSiteHealth(
  site: string,
  credential: Credential,
  options: FetchSiteHealthOptions = {},
): Promise<HealthCheck[]> {
  const timeoutMs = options.timeoutMs ?? HEALTH_TIMEOUT_MS;
  const budgetMs = options.budgetMs ?? HEALTH_BUDGET_MS;
  const now = options.now ?? Date.now;

  const deadline = now() + budgetMs;
  const results: HealthCheck[] = [];

  for (const test of HEALTH_TESTS) {
    if (now() >= deadline) {
      // Orçamento esgotado: as checagens restantes não são sequer tentadas.
      // 'unknown' explícito, nunca 'good' e nunca omitido da lista — ver a
      // REGRA DE OURO no topo do arquivo.
      results.push({
        test,
        status: 'unknown',
        label: 'Não verificado: o orçamento de tempo da varredura de saúde do site se esgotou.',
        badge: '',
      });
      continue;
    }

    try {
      const data = await wpGet(site, `/wp-json/wp-site-health/v1/tests/${test}`, credential, { timeoutMs });
      results.push(normalizeHealth(test, data));
    } catch {
      results.push({
        test,
        status: 'unknown',
        label: 'Não foi possível verificar este teste.',
        badge: '',
      });
    }
  }

  return results;
}
