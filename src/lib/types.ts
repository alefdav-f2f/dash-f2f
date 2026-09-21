// Contratos de dados compartilhados entre servidor e cliente.

/** Plugin normalizado a partir de /wp-json/wp/v2/plugins (ver src/lib/wp-rest.ts). */
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
  /**
   * Só preenchido quando `kind === 'unauthorized'`: `last_verified_at` da
   * credencial ANTES desta tentativa falhar — o único sinal que existe para
   * separar "nunca funcionou" de "funcionava e parou" (ver
   * src/app/api/plugins/route.ts e src/components/States.tsx).
   *
   * Três estados, não dois — por isso é um campo dedicado em vez de reusar
   * `detail` (que é texto livre, não dado estruturado, e já significa outra
   * coisa: mensagem técnica crua de erro de rede):
   *  - campo ausente  → sinal indisponível; a UI não deve adivinhar.
   *  - `null`         → nunca verificou (primeiro cadastro).
   *  - string ISO     → verificou pela última vez nesta data.
   */
  credentialLastVerifiedAt?: string | null;
};

/**
 * Mensagem fixa emitida por `src/lib/wp-rest.ts` quando o WordPress devolve
 * 401. Exportada aqui — não em `wp-rest.ts`, que é `server-only` e não pode
 * ser importado por componentes cliente — para que `CredentialForm` consiga
 * reconhecer este caso específico a partir de `CredentialInfo.last_error`,
 * que só guarda texto, não o `ApiErrorKind` que gerou o texto.
 */
export const UNAUTHORIZED_CREDENTIAL_MESSAGE =
  'Credencial recusada. A Application Password pode ter sido revogada no WordPress, ou o servidor está descartando o cabeçalho Authorization.';

export type PluginsResponse = {
  site: string;
  scanId: string;
  fetchedAt: string;
  plugins: Plugin[];
  themes: Theme[];
  users: WpUser[];
  settings: WpSettings | null;
  health: HealthCheck[];
  content: ContentActivity[];
  /** Recursos que não puderam ser lidos nesta varredura, com o motivo. */
  failures: Partial<Record<InventoryResource, string>>;
  /** Mudanças de plugin desde a varredura anterior (vazio na primeira). */
  changes: import('./diff').Change[];
  /**
   * Mudanças de usuário, tema e settings desde a varredura anterior — cada uma
   * carrega `resource` ('user' | 'theme' | 'settings') para a Task 11 agrupar na
   * exibição. Separado de `changes` de propósito: `changes` é indexado por file
   * de plugin em `changesByFile`/`PluginTable`, e usuário (id numérico) ou tema
   * (stylesheet) usando a mesma chave arriscaria colisão e marcaria a linha
   * errada na tabela de plugins.
   */
  resourceChanges: import('./diff').Change[];
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

/** Tema como sai do /wp/v2/themes, antes de cruzar com o wordpress.org. */
export type RawTheme = {
  stylesheet: string;
  name: string;
  /** `null` quando o site não informou versão — nunca o placeholder de exibição. */
  version: string | null;
  is_active: boolean;
};

export type Theme = {
  stylesheet: string;
  name: string;
  version: string;
  is_active: boolean;
  has_update: boolean;
  new_version: string;
  update_source: UpdateSource;
};

export type WpUser = {
  wp_user_id: number;
  slug: string;
  name: string;
  roles: string;
};

export type WpSettings = {
  title: string;
  description: string;
  url: string;
  admin_email: string;
  timezone: string;
  language: string;
};

export type HealthStatus = 'good' | 'recommended' | 'critical' | 'unknown';

export type HealthCheck = {
  /** Slug do teste na URL, ex.: 'authorization-header'. */
  test: string;
  status: HealthStatus;
  label: string;
  badge: string;
};

/**
 * Post ou página normalizado a partir de /wp/v2/posts ou /wp/v2/pages,
 * ordenado por `modified` — não um log de auditoria (o WordPress core não
 * guarda quem mudou o quê, só o estado atual; ver src/lib/wp-rest.ts).
 */
export type ContentActivity = {
  id: number;
  kind: 'post' | 'page';
  title: string;
  /** ISO do WordPress; é a data da última alteração do conteúdo. */
  modified: string;
  /** Autor registrado do conteúdo — NÃO necessariamente quem fez a última alteração. */
  author_id: number;
  status: string;
  link: string;
};

/** Recursos opcionais do inventário, além de plugins. */
export type InventoryResource = 'themes' | 'users' | 'settings' | 'health' | 'content';

export type SiteInventory = {
  plugins: Plugin[];
  themes: Theme[];
  users: WpUser[];
  settings: WpSettings | null;
  health: HealthCheck[];
  content: ContentActivity[];
  /**
   * Recursos que não puderam ser lidos, com o motivo. Vazio = tudo leu.
   *
   * Existe para que a UI distinga "este site não tem usuários" de "não
   * conseguimos ler os usuários" — sem isso, um 403 em /wp/v2/users (falta a
   * capability list_users) vira uma aba vazia que parece um fato.
   */
  failures: Partial<Record<InventoryResource, string>>;
};
