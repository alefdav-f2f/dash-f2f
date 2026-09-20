import 'server-only';

// Cliente da REST API nativa do WordPress, autenticado por Application Password.
// Substitui src/lib/wp.ts: em vez de um endpoint customizado público, fala com
// /wp-json/wp/v2/* usando Basic auth.
//
// CONTRATO: só GET sai daqui. A credencial tem poder de escrita no WordPress
// (Application Password herda TODAS as capabilities do usuário — o core não tem
// escopo granular), então a disciplina de só-GET deixou de ser garantida pela
// credencial e passou a ser garantida por este módulo. Não adicione outro método.

import { isPrivateHost } from './site-url';
import type { ApiErrorKind, RawPlugin } from './types';

const TIMEOUT_MS = 12_000;

export type Credential = { user: string; password: string };

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
export async function wpGet(site: string, path: string, credential: Credential): Promise<unknown> {
  if (process.env.ALLOW_PRIVATE_HOSTS !== '1' && isPrivateHost(new URL(site).hostname)) {
    throw new WpError('invalid_url', 400, 'Endereços locais ou de rede interna não são permitidos.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

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
    throw new WpError(
      'unauthorized',
      401,
      'Credencial recusada. A Application Password pode ter sido revogada no WordPress, ou o servidor está descartando o cabeçalho Authorization.',
    );
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
    // "elementor/elementor" -> "elementor"; plugin de arquivo único -> ele mesmo.
    slug: file.split('/')[0],
  };
}
