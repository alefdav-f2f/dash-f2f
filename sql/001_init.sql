-- dash-f2f — schema inicial.
-- sites pertencem a um usuário do Neon Auth (owner_id = session.user.id).
-- Cada consulta vira um scan imutável + o snapshot dos plugins daquele momento.

CREATE TABLE IF NOT EXISTS sites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    text NOT NULL,
  url         text NOT NULL,
  label       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, url)
);

CREATE INDEX IF NOT EXISTS sites_owner_idx ON sites (owner_id, created_at);

CREATE TABLE IF NOT EXISTS scans (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id        uuid NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
  fetched_at     timestamptz NOT NULL DEFAULT now(),
  ok             boolean NOT NULL,
  error_kind     text,
  error_message  text,
  total          integer NOT NULL DEFAULT 0,
  active         integer NOT NULL DEFAULT 0,
  outdated       integer NOT NULL DEFAULT 0,
  inactive       integer NOT NULL DEFAULT 0,
  source         text NOT NULL DEFAULT 'manual'
);

CREATE INDEX IF NOT EXISTS scans_site_time_idx ON scans (site_id, fetched_at DESC);

CREATE TABLE IF NOT EXISTS scan_plugins (
  scan_id      uuid NOT NULL REFERENCES scans (id) ON DELETE CASCADE,
  file         text NOT NULL,
  name         text NOT NULL,
  version      text NOT NULL,
  new_version  text NOT NULL DEFAULT '',
  is_active    boolean NOT NULL,
  has_update   boolean NOT NULL,
  PRIMARY KEY (scan_id, file)
);
