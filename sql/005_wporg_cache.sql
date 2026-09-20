-- Cache das versões publicadas no repositório oficial do WordPress.
-- Dado público e igual para todo mundo: compartilhado entre contas de propósito.
-- latest_version NULL = plugin não existe no repositório (premium ou customizado).
-- Só resposta real do wp.org chega aqui; falha de consulta não vira cache.

CREATE TABLE IF NOT EXISTS wporg_versions (
  slug            text PRIMARY KEY,
  latest_version  text,
  checked_at      timestamptz NOT NULL DEFAULT now()
);
