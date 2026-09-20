-- update_source registra a PROCEDÊNCIA do veredito de atualização. Sem isso o
-- histórico não distingue "em dia" de "não sabemos".
--
-- O DEFAULT é 'site' de propósito: toda linha que já existe aqui foi colhida
-- pelo coletor antigo, cujo has_update vinha do endpoint customizado lendo o
-- transient `update_plugins` do próprio WordPress. Carimbar essas linhas como
-- 'unknown' subestimaria o que de fato sabíamos; carimbar 'wporg' seria falso,
-- porque o wordpress.org nunca foi consultado. Linhas novas sempre informam o
-- valor explicitamente.

ALTER TABLE scan_plugins
  ADD COLUMN IF NOT EXISTS update_source text NOT NULL DEFAULT 'site';
