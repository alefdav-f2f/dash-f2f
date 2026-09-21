import 'server-only';

// Cliente da REST API nativa do WordPress, autenticado por Application Password.
// Substituiu o antigo src/lib/wp.ts (removido): em vez de um endpoint customizado
// público, fala com /wp-json/wp/v2/* usando Basic auth.
//
// CONTRATO: só GET sai daqui. A credencial tem poder de escrita no WordPress
// (Application Password herda TODAS as capabilities do usuário — o core não tem
// escopo granular), então a disciplina de só-GET deixou de ser garantida pela
// credencial e passou a ser garantida por este módulo. Não adicione outro método.

import { isPrivateHost } from './site-url';
import { latestThemeVersions, latestVersions } from './wporg';
import { mergePluginVersions, mergeThemeVersions } from './inventory';
import { fetchSiteHealth } from './wp-health';
import type { ApiErrorKind, ContentActivity, HealthCheck, InventoryResource, Plugin, RawPlugin, RawTheme, SiteInventory, Theme, WpSettings, WpUser } from './types';
import { UNAUTHORIZED_CREDENTIAL_MESSAGE } from './types';

const TIMEOUT_MS = 12_000;

export type Credential = { user: string; password: string };

/** Opções de `wpGet`. Minimalista de propósito — só o que o Site Health precisou. */
export type WpGetOptions = { timeoutMs?: number };

export class WpError extends Error {
  kind: ApiErrorKind;
  status: number;
  detail?: string;
  constructor(kind: ApiErrorKind, status: number, message: string, detail?: string) {
    super(message);
    this.name = 'WpError';
    this.kind = kind;
    this.status = status;
    this.detail = detail;
  }
}

function authHeader({ user, password }: Credential): string {
  return 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');
}

/**
 * GET autenticado num caminho da REST API. Devolve o JSON já parseado.
 * Nenhuma mensagem de erro daqui inclui a credencial.
 */
export async function wpGet(site: string, path: string, credential: Credential, options?: WpGetOptions): Promise<unknown> {
  if (process.env.ALLOW_PRIVATE_HOSTS !== '1' && isPrivateHost(new URL(site).hostname)) {
    throw new WpError('invalid_url', 400, 'Endereços locais ou de rede interna não são permitidos.');
  }

  const timeoutMs = options?.timeoutMs ?? TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let upstream: Response;
  try {
    upstream = await fetch(`${site}${path}`, {
      method: 'GET', // read-only, sempre
      headers: {
        Accept: 'application/json',
        Authorization: authHeader(credential),
        'User-Agent': 'dash-f2f/2.0 (read-only inventory)',
      },
      redirect: 'follow',
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    throw new WpError(
      'network',
      504,
      aborted ? 'O site não respondeu a tempo.' : 'Falha de rede ao contatar o site.',
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    clearTimeout(timer);
  }

  if (upstream.status === 401) {
    throw new WpError('unauthorized', 401, UNAUTHORIZED_CREDENTIAL_MESSAGE);
  }
  if (upstream.status === 403) {
    throw new WpError(
      'forbidden',
      403,
      'O usuário não tem permissão para este recurso. Ler plugins exige a capability activate_plugins (administrador).',
    );
  }
  if (upstream.status === 404) {
    throw new WpError('not_found', 404, `Rota ${path} não encontrada. A REST API pode estar desabilitada neste site.`);
  }
  if (!upstream.ok) {
    throw new WpError('http', 502, `O site respondeu ${upstream.status} ${upstream.statusText}.`);
  }

  try {
    return await upstream.json();
  } catch {
    throw new WpError('bad_payload', 502, 'A resposta do site não é JSON válido.');
  }
}

/** Inventário cru de plugins. `has_update` NÃO vem daqui — ver src/lib/inventory.ts. */
export async function fetchRawPlugins(site: string, credential: Credential): Promise<RawPlugin[]> {
  const data = await wpGet(site, '/wp-json/wp/v2/plugins', credential);
  if (!Array.isArray(data)) {
    throw new WpError('bad_payload', 502, 'A resposta de /wp/v2/plugins não é uma lista.');
  }
  return data.map(normalizeRawPlugin);
}

function normalizeRawPlugin(raw: unknown): RawPlugin {
  const p = (raw ?? {}) as Record<string, unknown>;
  const file = typeof p.plugin === 'string' ? p.plugin : '';
  return {
    file,
    name: typeof p.name === 'string' && p.name ? p.name : file || 'Plugin sem nome',
    // Versão ausente vira null, nunca '—'. O placeholder só aparece na hora de
    // renderizar (ver mergePluginVersions); como dado, ele seria lido como
    // versão 0 e faria um plugin de versão desconhecida contar como pendente.
    version: p.version != null && String(p.version).trim() ? String(p.version) : null,
    is_active: p.status === 'active',
    slug: wporgSlug(file, p.plugin_uri),
  };
}

/**
 * Slug com que o wordpress.org conhece o plugin.
 *
 * O caminho do arquivo quase sempre serve ("elementor/elementor" -> "elementor"),
 * mas não sempre: o Hello Dolly é `hello.php` na raiz, o que daria "hello" — e
 * no repositório ele é "hello-dolly". Resultado: um plugin que ESTÁ no
 * repositório apareceria como "atualização desconhecida".
 *
 * Quando o `plugin_uri` aponta para wordpress.org/plugins/<slug>, esse slug é
 * declarado pelo próprio plugin e vale mais que o nome da pasta. Só aí ele
 * ganha; no resto dos casos a pasta continua mandando.
 *
 * Achado rodando contra um WordPress real — os testes com fetch stubado não
 * pegavam, porque afirmavam que "hello" vira slug "hello", o que é verdade e
 * ainda assim é o slug errado.
 */
export function wporgSlug(file: string, pluginUri: unknown): string {
  const fromDir = file.split('/')[0];
  if (typeof pluginUri !== 'string') return fromDir;
  const match = pluginUri.match(/wordpress\.org\/plugins\/([^/?#]+)/i);
  return match ? match[1] : fromDir;
}

/**
 * Varredura completa de plugins: lê o site, cruza com o wordpress.org e
 * devolve o tipo que a UI e o histórico já consomem.
 */
export async function collectPlugins(site: string, credential: Credential): Promise<Plugin[]> {
  const raw = await fetchRawPlugins(site, credential);
  const latest = await latestVersions(raw.map((p) => p.slug));
  return mergePluginVersions(raw, latest);
}

/** `name` e `description` podem vir como string ou como { raw, rendered }. */
function flatten(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.raw === 'string') return obj.raw;
    if (typeof obj.rendered === 'string') return obj.rendered;
  }
  return '';
}

/** Inventário cru de temas. `has_update` NÃO vem daqui — ver src/lib/inventory.ts. */
export async function fetchThemes(site: string, credential: Credential): Promise<RawTheme[]> {
  const data = await wpGet(site, '/wp-json/wp/v2/themes', credential);
  if (!Array.isArray(data)) throw new WpError('bad_payload', 502, 'A resposta de /wp/v2/themes não é uma lista.');
  return data.map((raw) => {
    const t = (raw ?? {}) as Record<string, unknown>;
    return {
      stylesheet: typeof t.stylesheet === 'string' ? t.stylesheet : '',
      name: flatten(t.name),
      // Versão ausente ou vazia vira null, nunca '—' — mesma regra de
      // normalizeRawPlugin: o placeholder de exibição só aparece na fronteira
      // de renderização (mergeThemeVersions), nunca como dado.
      version: t.version != null && String(t.version).trim() ? String(t.version) : null,
      is_active: t.status === 'active',
    };
  });
}

/**
 * Varredura completa de temas: lê o site, cruza com o wordpress.org e
 * devolve o tipo que a UI e o histórico já consomem. Espelha collectPlugins.
 */
export async function collectThemes(site: string, credential: Credential): Promise<Theme[]> {
  const raw = await fetchThemes(site, credential);
  const latest = await latestThemeVersions(raw.map((t) => t.stylesheet));
  return mergeThemeVersions(raw, latest);
}

export async function fetchUsers(site: string, credential: Credential): Promise<WpUser[]> {
  // context=edit é o que traz `roles`; exige capability list_users.
  const data = await wpGet(site, '/wp-json/wp/v2/users?context=edit&per_page=100', credential);
  if (!Array.isArray(data)) throw new WpError('bad_payload', 502, 'A resposta de /wp/v2/users não é uma lista.');
  return data.map((raw) => {
    const u = (raw ?? {}) as Record<string, unknown>;
    return {
      wp_user_id: Number(u.id ?? 0),
      slug: typeof u.slug === 'string' ? u.slug : '',
      name: flatten(u.name),
      roles: Array.isArray(u.roles) ? u.roles.join(',') : '',
    };
  });
}

export async function fetchSettings(site: string, credential: Credential): Promise<WpSettings> {
  const data = await wpGet(site, '/wp-json/wp/v2/settings', credential);
  const s = (data ?? {}) as Record<string, unknown>;
  return {
    title: flatten(s.title),
    description: flatten(s.description),
    url: typeof s.url === 'string' ? s.url : '',
    admin_email: typeof s.email === 'string' ? s.email : '',
    timezone: typeof s.timezone === 'string' ? s.timezone : '',
    language: typeof s.language === 'string' ? s.language : '',
  };
}

/**
 * Parâmetros comuns às duas consultas de conteúdo recente.
 * `context=edit` é o que traz `modified` (e exige capability de editor);
 * `_fields` evita puxar `content`/`excerpt` inteiros de até 20+20 posts.
 * NÃO usar `/revisions`: é uma chamada por post, e um site com centenas de
 * posts estouraria o orçamento de uma varredura (ver AGENTS/plano da Task 12).
 */
const CONTENT_QUERY = 'context=edit&orderby=modified&order=desc&per_page=20&_fields=id,title,modified,author,status,link';

function normalizeContentItem(raw: unknown, kind: ContentActivity['kind']): ContentActivity {
  const c = (raw ?? {}) as Record<string, unknown>;
  return {
    id: Number(c.id ?? 0),
    kind,
    title: flatten(c.title),
    modified: typeof c.modified === 'string' ? c.modified : '',
    author_id: Number(c.author ?? 0),
    status: typeof c.status === 'string' ? c.status : '',
    link: typeof c.link === 'string' ? c.link : '',
  };
}

async function fetchContentKind(
  site: string,
  path: string,
  kind: ContentActivity['kind'],
  credential: Credential,
): Promise<ContentActivity[]> {
  const data = await wpGet(site, `${path}?${CONTENT_QUERY}`, credential);
  if (!Array.isArray(data)) {
    throw new WpError('bad_payload', 502, `A resposta de ${path} não é uma lista.`);
  }
  return data.map((raw) => normalizeContentItem(raw, kind));
}

/**
 * Posts e páginas modificados recentemente, mesclados e ordenados por
 * `modified` decrescente. Duas requisições, nunca uma por post (ver
 * CONTENT_QUERY).
 *
 * DECISÃO: se qualquer uma das duas falhar, a função inteira falha — não
 * degrada devolvendo só a metade que deu certo. `collectInventory` já tem o
 * mecanismo certo para "não deu pra ler" (`failures`, por recurso); se
 * `fetchRecentContent` engolisse a falha de `/pages` e devolvesse só os
 * posts, a Atividade da Task 13 mostraria "nenhuma página mudou
 * recentemente" — um fato — quando a verdade é "não sabemos". Silêncio
 * parcial que parece dado completo é exatamente o que este projeto evita em
 * `failures` para temas/usuários/settings/health; falhar o recurso inteiro
 * aqui e deixar o `attempt('content', …)` registrar o motivo é consistente
 * com essa regra, em vez de abrir uma exceção silenciosa só para conteúdo.
 */
export async function fetchRecentContent(site: string, credential: Credential): Promise<ContentActivity[]> {
  const [posts, pages] = await Promise.all([
    fetchContentKind(site, '/wp-json/wp/v2/posts', 'post', credential),
    fetchContentKind(site, '/wp-json/wp/v2/pages', 'page', credential),
  ]);
  return [...posts, ...pages].sort((a, b) => (a.modified < b.modified ? 1 : a.modified > b.modified ? -1 : 0));
}

/**
 * Inventário completo. Plugins é obrigatório: se falhar, a varredura falhou.
 * Os outros três são best-effort — um 403 em /users (falta list_users) não pode
 * derrubar a varredura inteira de plugins —, mas o motivo da falha é guardado
 * em `failures` para a UI poder dizer "não foi possível ler" em vez de mostrar
 * uma aba vazia que parece um fato.
 */
export async function collectInventory(site: string, credential: Credential): Promise<SiteInventory> {
  const plugins = await collectPlugins(site, credential);
  const failures: Partial<Record<InventoryResource, string>> = {};

  async function attempt<T>(resource: InventoryResource, run: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await run();
    } catch (err) {
      failures[resource] = err instanceof Error ? err.message : 'Falha desconhecida.';
      return fallback;
    }
  }

  const [themes, users, settings, health, content] = await Promise.all([
    attempt('themes', () => collectThemes(site, credential), [] as Theme[]),
    attempt('users', () => fetchUsers(site, credential), [] as WpUser[]),
    attempt('settings', () => fetchSettings(site, credential), null as WpSettings | null),
    attempt('health', () => fetchSiteHealth(site, credential), [] as HealthCheck[]),
    attempt('content', () => fetchRecentContent(site, credential), [] as ContentActivity[]),
  ]);

  return { plugins, themes, users, settings, health, content, failures };
}
