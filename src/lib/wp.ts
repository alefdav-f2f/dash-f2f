import 'server-only';

// Leitura do WordPress. O ÚNICO ponto do sistema que sai para o site remoto,
// e ele só faz GET. Usado pela rota /api/plugins e pelo cron.

import { isPrivateHost } from './site-url';
import type { ApiErrorKind, Plugin } from './types';

export const PLUGINS_PATH = '/wp-json/site-status/v1/plugins';
const TIMEOUT_MS = 12_000;

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

/**
 * Busca os plugins de um site WordPress.
 * @param site origem já normalizada (ex.: "https://exemplo.com")
 */
export async function fetchSitePlugins(site: string): Promise<Plugin[]> {
  // Hosts internos ficam bloqueados por padrão (o servidor não vira scanner da
  // rede onde o app roda). ALLOW_PRIVATE_HOSTS=1 libera Local WP / intranet.
  if (process.env.ALLOW_PRIVATE_HOSTS !== '1' && isPrivateHost(new URL(site).hostname)) {
    throw new WpError('invalid_url', 400, 'Endereços locais ou de rede interna não são permitidos.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let upstream: Response;
  try {
    upstream = await fetch(`${site}${PLUGINS_PATH}`, {
      method: 'GET', // read-only, sempre
      headers: { Accept: 'application/json', 'User-Agent': 'dash-f2f/1.0 (read-only plugin monitor)' },
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

  if (upstream.status === 404) {
    throw new WpError('not_found', 404, `Endpoint ${PLUGINS_PATH} não encontrado neste site.`);
  }
  if (!upstream.ok) {
    throw new WpError('http', 502, `O site respondeu ${upstream.status} ${upstream.statusText}.`);
  }

  let data: unknown;
  try {
    data = await upstream.json();
  } catch {
    throw new WpError('bad_payload', 502, 'A resposta do site não é JSON válido.');
  }

  // Aceita [ ... ] e { plugins: [ ... ] }
  const list = Array.isArray(data)
    ? data
    : Array.isArray((data as { plugins?: unknown[] })?.plugins)
      ? (data as { plugins: unknown[] }).plugins
      : null;

  if (!list) throw new WpError('bad_payload', 502, 'A resposta não contém um array de plugins.');

  return list.map(normalizePlugin);
}

/** Blinda a UI contra campos ausentes ou de tipo inesperado. */
function normalizePlugin(raw: unknown): Plugin {
  const p = (raw ?? {}) as Record<string, unknown>;
  const file = typeof p.file === 'string' ? p.file : '';
  return {
    file,
    name: typeof p.name === 'string' && p.name ? p.name : file || 'Plugin sem nome',
    version: p.version != null ? String(p.version) : '—',
    is_active: Boolean(p.is_active),
    has_update: Boolean(p.has_update),
    new_version: p.new_version != null ? String(p.new_version) : '',
  };
}
