-- Resultado dos testes de Site Health do core, por varredura.
-- O core não expõe isso em lote: é uma rota por teste, então guardamos linha a linha.
-- `status` é o vocabulário do próprio WordPress: good | recommended | critical.
-- Guardamos também 'unknown', que é nosso: teste que não respondeu não é teste que passou.
--
-- description/actions do WordPress não entram aqui: são blocos de HTML longos, e o
-- painel não renderiza HTML de terceiro. O label já diz o que importa.

CREATE TABLE IF NOT EXISTS scan_health (
  scan_id     uuid NOT NULL REFERENCES scans (id) ON DELETE CASCADE,
  test        text NOT NULL,
  status      text NOT NULL,
  label       text NOT NULL DEFAULT '',
  badge       text NOT NULL DEFAULT '',
  PRIMARY KEY (scan_id, test)
);
