-- Snapshots dos demais recursos que a Application Password abre.
-- Mesma regra dos plugins: imutável, um por scan.

CREATE TABLE IF NOT EXISTS scan_themes (
  scan_id     uuid NOT NULL REFERENCES scans (id) ON DELETE CASCADE,
  stylesheet  text NOT NULL,
  name        text NOT NULL,
  version     text NOT NULL DEFAULT '',
  is_active   boolean NOT NULL DEFAULT false,
  PRIMARY KEY (scan_id, stylesheet)
);

CREATE TABLE IF NOT EXISTS scan_users (
  scan_id   uuid NOT NULL REFERENCES scans (id) ON DELETE CASCADE,
  wp_user_id integer NOT NULL,
  slug      text NOT NULL DEFAULT '',
  name      text NOT NULL DEFAULT '',
  roles     text NOT NULL DEFAULT '',
  PRIMARY KEY (scan_id, wp_user_id)
);

CREATE TABLE IF NOT EXISTS scan_settings (
  scan_id      uuid PRIMARY KEY REFERENCES scans (id) ON DELETE CASCADE,
  title        text NOT NULL DEFAULT '',
  description  text NOT NULL DEFAULT '',
  url          text NOT NULL DEFAULT '',
  admin_email  text NOT NULL DEFAULT '',
  timezone     text NOT NULL DEFAULT '',
  language     text NOT NULL DEFAULT ''
);

-- scan_users.roles guarda a lista separada por vírgula. Não normalize em
-- tabela própria: o dado é lido em bloco e nunca consultado por papel
-- isolado. YAGNI.
