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

/**
 * De onde saiu o veredito de atualização pendente. Procedência, não qualidade.
 *  - 'wporg'   — comparamos a versão instalada com a publicada no wordpress.org
 *  - 'site'    — o próprio site afirmou, via o endpoint customizado antigo, que
 *                lia o transient `update_plugins`. Só existe em histórico
 *                anterior à migração; nenhum código novo produz este valor.
 *  - 'unknown' — não dá para afirmar nada (plugin fora do repositório oficial,
 *                ou versão instalada ilegível).
 */
export type UpdateSource = 'wporg' | 'site' | 'unknown';

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

/**
 * Status público da credencial de um site — nunca inclui a senha, nem cifrada.
 * Tipo compartilhado entre `src/lib/credentials.ts` (server-only, que também
 * guarda `created_at`) e os componentes cliente que só precisam destes três
 * campos para desenhar o formulário.
 */
export type CredentialInfo = {
  wp_user: string;
  last_verified_at: string | null;
  last_error: string | null;
};
