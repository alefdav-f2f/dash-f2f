-- Tokens pessoais para o conector MCP remoto.
-- Guardamos só o hash: o valor em claro aparece uma única vez, na criação.

CREATE TABLE IF NOT EXISTS api_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     text NOT NULL REFERENCES app_users (id) ON DELETE CASCADE,
  name         text NOT NULL,
  token_hash   text NOT NULL UNIQUE,   -- sha256 do token em claro
  prefix       text NOT NULL,          -- primeiros caracteres, para o usuário reconhecer na lista
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

CREATE INDEX IF NOT EXISTS api_tokens_owner_idx ON api_tokens (owner_id, created_at DESC);
