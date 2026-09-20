-- O cache do wordpress.org passa a cobrir temas além de plugins, e um mesmo slug
-- pode existir nos dois espaços de nome. A chave vira (kind, slug).
-- As linhas que já existem são todas de plugin, daí o DEFAULT.

ALTER TABLE wporg_versions ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'plugin';

ALTER TABLE wporg_versions DROP CONSTRAINT IF EXISTS wporg_versions_pkey;

ALTER TABLE wporg_versions ADD PRIMARY KEY (kind, slug);
