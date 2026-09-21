-- Conteúdos (posts e páginas) mais recentemente alterados, por varredura.
-- author_id é o autor REGISTRADO do conteúdo, não quem fez a última alteração:
-- o WordPress não guarda quem editou por último fora das revisões, e ler revisões
-- custaria uma requisição por post.

CREATE TABLE IF NOT EXISTS scan_content (
  scan_id    uuid NOT NULL REFERENCES scans (id) ON DELETE CASCADE,
  kind       text NOT NULL,
  id         integer NOT NULL,
  title      text NOT NULL DEFAULT '',
  -- `modified` fica como texto de propósito: é o timestamp local do site, sem
  -- fuso, que o WordPress devolve em `context=edit`. Convertê-lo para
  -- timestamptz aqui exigiria assumir um fuso (UTC? o do servidor Neon? o do
  -- site?) que ninguém informou — e um fuso inventado é pior que nenhum.
  modified   text NOT NULL DEFAULT '',
  author_id  integer NOT NULL DEFAULT 0,
  status     text NOT NULL DEFAULT '',
  link       text NOT NULL DEFAULT '',
  PRIMARY KEY (scan_id, kind, id)
);
