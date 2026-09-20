import 'server-only';

// Versão publicada de cada plugin no repositório oficial.
//
// Existe porque /wp/v2/plugins não devolve atualização pendente. Cruzamos a
// versão instalada com a daqui para calcular has_update.
//
// LIMITE CONHECIDO: só cobre plugin do repositório oficial. Elementor Pro,
// ACF Pro e plugin customizado de agência devolvem null — e null NUNCA vira
// "está em dia", vira update_source: 'unknown' na UI.

import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

// Conexão preguiçosa: criada só no primeiro uso, não na importação do módulo.
// Assim os testes puros (parseWporgResponse) e os de rede (fetchFromWporg,
// com fetch stubado) rodam sem precisar de DATABASE_URL.
let cached: NeonQueryFunction<false, false> | null = null;

function sql(): NeonQueryFunction<false, false> {
  if (cached) return cached;
  cached = neon(process.env.DATABASE_URL!);
  return cached;
}

const PLUGIN_ENDPOINT = 'https://api.wordpress.org/plugins/info/1.0/';
const THEME_ENDPOINT = 'https://api.wordpress.org/themes/info/1.1/';
const TTL_HOURS = 12;
const TIMEOUT_MS = 8_000;
/** Teto de tempo gasto consultando o wp.org por varredura. Ver o laço abaixo. */
const BUDGET_MS = 60_000;

/** Exportada para teste: a forma da resposta do wp.org é instável. */
export function parseWporgResponse(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const body = data as Record<string, unknown>;
  if (body.error) return null;
  return typeof body.version === 'string' ? body.version : null;
}

/**
 * Duas ausências que NÃO podem ser confundidas:
 *  - `{ known: true, version: null }` — o wp.org respondeu e disse que o plugin
 *    não existe no repositório. É fato, e pode ser cacheado.
 *  - `{ known: false }` — a consulta falhou (rede, timeout, 500). Não sabemos
 *    nada, e gravar isso como null no cache faria um plugin comum aparecer
 *    como "atualização desconhecida" por 12 horas por causa de um soluço de
 *    rede. Não cacheia.
 */
type Lookup = { known: true; version: string | null } | { known: false };

/** Faz o GET no wp.org e traduz a resposta para {@link Lookup}. Compartilhado
 * por plugins e temas: só muda a URL. */
async function fetchWporg(url: string): Promise<Lookup> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': 'dash-f2f/2.0' },
      cache: 'no-store',
      signal: controller.signal,
    });
    // 404 é resposta legítima: o slug não está no repositório (plugin ou tema).
    if (response.status === 404) return { known: true, version: null };
    if (!response.ok) return { known: false };
    return { known: true, version: parseWporgResponse(await response.json()) };
  } catch {
    // Rede ou timeout: indisponibilidade nossa, não ausência do item.
    return { known: false };
  } finally {
    clearTimeout(timer);
  }
}

/** Exportada para teste: a distinção known/unknown é o que protege o cache. */
export async function fetchFromWporg(slug: string): Promise<Lookup> {
  return fetchWporg(`${PLUGIN_ENDPOINT}${encodeURIComponent(slug)}.json`);
}

/** Exportada para teste: mesma distinção known/unknown, endpoint de temas. */
export async function fetchThemeFromWporg(slug: string): Promise<Lookup> {
  return fetchWporg(
    `${THEME_ENDPOINT}?action=theme_information&request[slug]=${encodeURIComponent(slug)}&request[fields][sections]=false`,
  );
}

/**
 * Corpo compartilhado por `latestVersions` e `latestThemeVersions`: lê o cache
 * por (kind, slug), busca só o que venceu, respeitando TTL e BUDGET_MS, e só
 * grava no cache resposta que o wp.org de fato deu (ver nota em `fetchWporg`
 * sobre known/unknown).
 */
async function latestByKind(
  kind: 'plugin' | 'theme',
  slugs: string[],
  fetcher: (slug: string) => Promise<Lookup>,
): Promise<Map<string, string | null>> {
  const unique = [...new Set(slugs.filter(Boolean))];
  const result = new Map<string, string | null>();
  if (unique.length === 0) return result;

  const cachedRows = (await sql()`
    SELECT slug, latest_version, checked_at
      FROM wporg_versions
     WHERE kind = ${kind}
       AND slug = ANY(${unique}::text[])
       AND checked_at > now() - ${`${TTL_HOURS} hours`}::interval
  `) as Array<{ slug: string; latest_version: string | null }>;

  for (const row of cachedRows) result.set(row.slug, row.latest_version);

  const missing = unique.filter((slug) => !result.has(slug));
  if (missing.length === 0) return result;

  // Sequencial de propósito: o wp.org não gosta de rajada, e isso roda no cron.
  // O orçamento existe porque um site com 60 plugins, todos frios e todos
  // lentos, passaria do maxDuration de 300s da rota de cron. Estourado o tempo,
  // o resto fica sem dado NESTA rodada e tenta de novo na próxima — que é
  // diferente de gravar "não existe no repositório".
  const deadline = Date.now() + BUDGET_MS;

  for (const slug of missing) {
    if (Date.now() > deadline) {
      result.set(slug, null);
      continue;
    }

    const lookup = await fetcher(slug);
    result.set(slug, lookup.known ? lookup.version : null);

    // Só grava o que o wp.org afirmou. Falha de consulta não vira cache:
    // caso contrário um timeout de um segundo faria o item aparecer como
    // "atualização desconhecida" pelas próximas 12 horas.
    if (lookup.known) {
      await sql()`
        INSERT INTO wporg_versions (kind, slug, latest_version, checked_at)
        VALUES (${kind}, ${slug}, ${lookup.version}, now())
        ON CONFLICT (kind, slug) DO UPDATE
           SET latest_version = EXCLUDED.latest_version, checked_at = now()
      `;
    }
  }

  return result;
}

/**
 * Versão publicada de cada slug de plugin. Lê do cache, busca só o que venceu.
 * @returns mapa slug -> versão publicada (ou null quando não há dado)
 */
export async function latestVersions(slugs: string[]): Promise<Map<string, string | null>> {
  return latestByKind('plugin', slugs, fetchFromWporg);
}

/**
 * Versão publicada de cada slug de tema. Mesmo cache, mesmo TTL, mesmo
 * orçamento de tempo — ver `latestByKind`.
 * @returns mapa slug -> versão publicada (ou null quando não há dado)
 */
export async function latestThemeVersions(slugs: string[]): Promise<Map<string, string | null>> {
  return latestByKind('theme', slugs, fetchThemeFromWporg);
}
