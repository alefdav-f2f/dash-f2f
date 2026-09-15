-- Diretório local de usuários.
-- O Neon Auth deste projeto não expõe `neon_auth.users_sync`, então guardamos o
-- mínimo para ir de e-mail → owner_id (é o que o MCP precisa para escopar).
-- Preenchida a partir da sessão, a cada acesso autenticado.

CREATE TABLE IF NOT EXISTS app_users (
  id          text PRIMARY KEY,   -- id do Neon Auth; é o mesmo valor de sites.owner_id
  email       text NOT NULL,
  name        text,
  first_seen  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS app_users_email_idx ON app_users (lower(email));
