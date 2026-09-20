-- Tema passa a ter veredito de atualização, igual a plugin.
-- update_source default 'unknown' — diferente de scan_plugins, que usou 'site':
-- lá havia histórico colhido de um endpoint que afirmava has_update; aqui o
-- histórico nunca teve veredito nenhum, então 'unknown' é o rótulo honesto.

ALTER TABLE scan_themes ADD COLUMN IF NOT EXISTS has_update boolean NOT NULL DEFAULT false;

ALTER TABLE scan_themes ADD COLUMN IF NOT EXISTS new_version text NOT NULL DEFAULT '';

ALTER TABLE scan_themes ADD COLUMN IF NOT EXISTS update_source text NOT NULL DEFAULT 'unknown';
