// Contratos de dados compartilhados entre servidor e cliente.

/** Objeto retornado pelo endpoint /wp-json/site-status/v1/plugins */
export type Plugin = {
  file: string;
  name: string;
  version: string;
  is_active: boolean;
  has_update: boolean;
  new_version: string;
};

export type PluginStatusKey =
  | 'active-outdated'
  | 'active'
  | 'inactive-outdated'
  | 'inactive';

export type ApiErrorKind =
  | 'invalid_url'
  | 'not_found'
  | 'http'
  | 'network'
  | 'bad_payload';

/** Resposta de erro da nossa rota interna. */
export type ApiErrorPayload = {
  error: true;
  kind: ApiErrorKind;
  message: string;
  detail?: string;
};

export type PluginsResponse = {
  site: string;
  scanId: string;
  fetchedAt: string;
  plugins: Plugin[];
  /** Mudanças desde a varredura anterior (vazio na primeira). */
  changes: import('./diff').Change[];
  previousScanAt: string | null;
};
