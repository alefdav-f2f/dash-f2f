-- Sites deixam de pertencer a um usuário e passam a ser da equipe.
-- owner_id vira added_by: continua registrando quem cadastrou, mas não recorta mais
-- quem enxerga. Uma coluna que não significa mais "dono" com nome de dono engana
-- quem lê o schema — daí o rename em vez de só mudar o uso.
--
-- A unicidade passa de (owner_id, url) para (url): compartilhado, o mesmo site não
-- pode existir duas vezes na lista da equipe.

ALTER TABLE sites RENAME COLUMN owner_id TO added_by;

ALTER TABLE sites DROP CONSTRAINT sites_owner_id_url_key;

ALTER TABLE sites ADD CONSTRAINT sites_url_key UNIQUE (url);

-- sites_owner_idx era (owner_id, created_at), para servir WHERE owner_id = ? ORDER BY
-- created_at. Essa consulta some: agora todo usuário vê todos os sites, sem recorte
-- por quem cadastrou. Índice por added_by não serve mais a nenhuma query real — cai.
-- No lugar, a listagem da equipe passa a ser ORDER BY created_at sem filtro (já é o
-- que listAllSites() faz em src/lib/db.ts); um índice simples em created_at sustenta
-- esse ORDER BY conforme a tabela cresce.

DROP INDEX sites_owner_idx;

CREATE INDEX sites_created_at_idx ON sites (created_at);
