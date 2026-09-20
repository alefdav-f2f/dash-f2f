// Camada de dados do browser. Nunca chama o WordPress direto: fala com a
// nossa rota interna (Route Handler), que faz o GET pelo servidor.

import type { ApiErrorKind, ApiErrorPayload, PluginsResponse } from './types';

export class ApiError extends Error {
  kind: ApiErrorKind;
  detail?: string;
  /** Só relevante para kind 'unauthorized'. Ver ApiErrorPayload em ./types. */
  credentialLastVerifiedAt?: string | null;
  constructor(kind: ApiErrorKind, message: string, detail?: string, credentialLastVerifiedAt?: string | null) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.detail = detail;
    this.credentialLastVerifiedAt = credentialLastVerifiedAt;
  }
}

/** GET /api/plugins?site=... — somente leitura. */
export async function fetchPlugins(site: string, signal?: AbortSignal): Promise<PluginsResponse> {
  let res: Response;
  try {
    res = await fetch(`/api/plugins?site=${encodeURIComponent(site)}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError('network', 'Não foi possível falar com o servidor do painel.');
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as ApiErrorPayload | null;
    throw new ApiError(
      payload?.kind ?? 'http',
      payload?.message ?? `Erro ${res.status} ao consultar o site.`,
      payload?.detail,
      payload?.credentialLastVerifiedAt,
    );
  }

  return (await res.json()) as PluginsResponse;
}
