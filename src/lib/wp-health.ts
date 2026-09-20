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
 * Roda os seis testes de Site Health em paralelo. Cada um é isolado: a
 * falha de um (rede, 403, 404, JSON inválido) não derruba os outros nem
 * reduz o tamanho da lista — ela sempre tem `HEALTH_TESTS.length` itens.
 */
export async function fetchSiteHealth(site: string, credential: Credential): Promise<HealthCheck[]> {
  return Promise.all(
    HEALTH_TESTS.map(async (test) => {
      try {
        const data = await wpGet(site, `/wp-json/wp-site-health/v1/tests/${test}`, credential);
        return normalizeHealth(test, data);
      } catch {
        return {
          test,
          status: 'unknown' as HealthStatus,
          label: 'Não foi possível verificar este teste.',
          badge: '',
        };
      }
    }),
  );
}
