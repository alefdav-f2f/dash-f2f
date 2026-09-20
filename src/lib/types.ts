// Contratos de dados compartilhados entre servidor e cliente.

/** Objeto retornado pelo endpoint /wp-json/site-status/v1/plugins */
export type Plugin = {
  file: string;
  name: string;
  version: string;
  is_active: boolean;
  has_update: boolean;
  new_version: string;
  /** 'unknown' = plugin fora do repositório oficial; has_update não é confiável. */
  update_source: UpdateSource;
};

/** De onde saiu o veredito de atualização pendente. */
export type UpdateSource = 'wporg' | 'unknown';

/** Plugin como sai do /wp/v2/plugins, antes de cruzar com o wordpress.org. */
export type RawPlugin = {
  file: string;
  name: string;
  /** `null` quando o site não informou versão. NÃO use '—' aqui: '—' é
   *  placeholder de exibição, e tratá-lo como dado faz `parse()` lê-lo como
   *  versão 0, o que transformaria "não sei" em "desatualizado". */
  version: string | null;
  is_active: boolean;
  slug: string;
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
  | 'bad_payload'
  | 'no_credential'   // site sem Application Password cadastrada
  | 'bad_credential'  // credencial gravada não decifra: pedir novo cadastro
  | 'unauthorized'    // 401: credencial errada ou revogada no WP
  | 'forbidden';      // 403: usuário sem capability (ex.: activate_plugins)

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
