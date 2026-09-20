-- Credencial de leitura de cada site: usuário WP + Application Password.
-- A senha NUNCA é gravada em claro — só o payload AES-256-GCM de src/lib/crypto.ts,
-- cuja chave (CREDENTIALS_KEY) vive fora do banco.
--
-- Um site tem no máximo uma credencial: site_id é a PK.

CREATE TABLE IF NOT EXISTS site_credentials (
  site_id           uuid PRIMARY KEY REFERENCES sites (id) ON DELETE CASCADE,
  wp_user           text NOT NULL,
  password_cipher   text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  last_verified_at  timestamptz,
  last_error        text
);

-- CRÍTICO: a role do MCP (dash_f2f_reader) recebe SELECT automático em toda
-- tabela nova por causa do ALTER DEFAULT PRIVILEGES em setup-reader-role.mjs.
-- O MCP é exposto publicamente em /api/mcp: ele não pode, em hipótese alguma,
-- ler esta tabela. A revogação abaixo é a segunda barreira (a primeira é o
-- REVOKE explícito no próprio script).

-- ATENÇÃO ao formato: scripts/migrate.mjs quebra o arquivo em statements com
-- `.split(/;\s*$/m)` — semicolon em fim de linha. Um bloco DO $$ ... $$ escrito
-- em várias linhas seria rasgado ao meio, porque os `;` internos caem em fim de
-- linha. Mantido em UMA linha de propósito: assim só o `$$;` final casa com o
-- separador. Não reformate isso para "ficar legível".
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dash_f2f_reader') THEN REVOKE ALL ON TABLE site_credentials FROM dash_f2f_reader; END IF; END $$;
