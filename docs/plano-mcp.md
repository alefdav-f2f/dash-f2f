# Plano — MCP somente leitura do dash-f2f

Servidor MCP que expõe, para um agente, as informações dos sites cadastrados e
suas varreduras, **lendo direto o Postgres do projeto**. Somente leitura, em três
camadas: permissão do banco, forma das queries e superfície das ferramentas.

Status: **implementado em 2026-09-15** (fases 0 a 4). Documentação de uso em
[`mcp/README.md`](../mcp/README.md). Duas coisas saíram diferentes do plano:

- **Testes com `node --test`**, não Vitest: o vitest 4 quebra o resolvedor do npm
  neste projeto (`Cannot read properties of null (reading 'edgesOut')` no
  arborist, ao montar o peer set do vite). O runner nativo do Node 22 cobre o
  mesmo e não adiciona dependência.
- **Sem branch Neon efêmero** para os testes: eles semeiam dois donos de teste no
  branch atual, verificam o isolamento e limpam no `after`. Um branch dedicado
  passa a valer a pena quando houver CI.

**A fase 5 também saiu** (mesmo dia): `/api/mcp` serve o mesmo conjunto de
ferramentas por HTTP, autenticado por token pessoal (`api_tokens`, sha256 no
banco). A tela `/conectores` gera a URL pronta para colar no Claude, no ChatGPT e
afins, lista os conectores ativos com último uso e revoga. O `owner_id` sai do
token, não de env var — que era o ponto da fase.

Diferença em relação ao previsto: o plano falava em OAuth como caminho natural;
ficou token na URL (ou `Authorization: Bearer`), porque é o que funciona em
cliente que só aceita colar endereço. Clientes que exigem OAuth ainda não são
atendidos.

---

## 1. Decisões de arquitetura

| decisão | escolha | porquê |
|---|---|---|
| Transporte | **stdio local** na v1 | roda na máquina do dev, sem expor rede nem inventar auth; MCP remoto fica para a v2 |
| Fonte de dados | **Postgres do projeto** (pedido explícito) | o histórico está lá; passar pela API HTTP do app duplicaria a camada |
| Escopo por usuário | `DASH_F2F_OWNER_EMAIL` na config do MCP | o servidor resolve o `owner_id` uma vez e injeta em **toda** query |
| Leitura garantida | role Postgres `dash_f2f_reader` com `GRANT SELECT` e nada mais | mesmo um bug no código não consegue escrever |
| SQL | consultas fixas e parametrizadas | sem tool de "query livre"; a superfície é o conjunto de ferramentas |
| Onde mora o código | `mcp/` dentro deste repo | compartilha tipos e schema; versiona junto com as migrations |

### O problema de mapear e-mail → `owner_id`

`sites.owner_id` guarda o id do Neon Auth, e este projeto **não tem**
`neon_auth.users_sync` (verificado: a relação não existe, e o endpoint de
listagem da management API responde 405). Hoje não há como ir de e-mail a
`owner_id` sem uma sessão.

**Fase 0 resolve isso**: uma tabela local `app_users`, preenchida a partir da
sessão sempre que o usuário age no app. Além do MCP, isso destrava lista de
usuários, "último acesso" e futura tela de admin.

---

## 2. Fases

### Fase 0 — base de dados (`sql/002_mcp.sql`)

```sql
CREATE TABLE app_users (
  id          text PRIMARY KEY,           -- id do Neon Auth (= sites.owner_id)
  email       text NOT NULL UNIQUE,
  name        text,
  first_seen  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now()
);

CREATE ROLE dash_f2f_reader LOGIN PASSWORD :'senha';
GRANT USAGE ON SCHEMA public TO dash_f2f_reader;
GRANT SELECT ON app_users, sites, scans, scan_plugins TO dash_f2f_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO dash_f2f_reader;
```

No app: `upsertUser(session.user)` em `requireUser()` — uma linha por usuário,
atualizando `last_seen`. Backfill dos `owner_id` já existentes fica sem e-mail
até o próximo login (aceitável: só há contas novas).

Connection string dessa role vai para `.env.local` como `DATABASE_URL_MCP`.

**Aceite:** `psql` com a role do MCP falha em `INSERT INTO sites …` e funciona em
`SELECT`.

### Fase 1 — esqueleto do servidor (`mcp/`)

```
mcp/
├─ package.json          bin: dash-f2f-mcp
├─ src/server.ts         registro das tools, transporte stdio
├─ src/db.ts             pool read-only + resolveOwner(email)
├─ src/queries.ts        SQL fixo, parametrizado, sempre com owner_id
└─ src/tools/*.ts        uma tool por arquivo
```

- `@modelcontextprotocol/sdk` + `@neondatabase/serverless` + `zod`.
- Boot: lê `DATABASE_URL_MCP` e `DASH_F2F_OWNER_EMAIL`; resolve o `owner_id`; se
  o e-mail não existir em `app_users`, falha na inicialização com mensagem clara.
- Todo resultado volta como JSON compacto + um resumo em texto (o agente lê
  melhor assim do que uma tabela ASCII).

### Fase 2 — ferramentas

| tool | entrada | devolve |
|---|---|---|
| `list_sites` | — | sites do usuário + última varredura (data, ok, total, desatualizados) |
| `get_site_status` | `site_url` | snapshot mais recente: todos os plugins com status |
| `list_outdated` | `site_url?` | plugins com `has_update`, agrupados por site quando sem filtro |
| `get_scan_history` | `site_url`, `limit?` (≤50) | série de varreduras: data, origem, ok, contadores |
| `diff_scans` | `site_url`, `from?`, `to?` | mudanças entre duas varreduras (reusa `src/lib/diff.ts`) |
| `find_plugin` | `plugin` (nome ou `file`), `only_outdated?` | em quais sites o plugin existe, versão em cada um |
| `fleet_summary` | — | nº de sites, quantos com pendência, quantos sem responder, top 5 plugins desatualizados |
| `list_failing_sites` | `since?` | sites cuja última varredura falhou, com `error_kind` |

Regras: toda tool recebe `owner_id` internamente (nunca como parâmetro),
`limit` com teto, e `site_url` normalizado pelo mesmo `normalizeSiteUrl` do app.

### Fase 3 — testes

- Vitest sobre `queries.ts` com um branch Neon efêmero (`neon branch create`) e
  seed de 2 usuários × 3 sites × 3 varreduras.
- Caso obrigatório: as queries do usuário A **nunca** retornam linha do usuário B.
- Caso obrigatório: tentativa de escrita pela role do MCP dá erro de permissão.

### Fase 4 — distribuição

`.mcp.json` versionado no repo:

```json
{
  "mcpServers": {
    "dash-f2f": {
      "command": "node",
      "args": ["./mcp/dist/server.js"],
      "env": {
        "DATABASE_URL_MCP": "${DATABASE_URL_MCP}",
        "DASH_F2F_OWNER_EMAIL": "${DASH_F2F_OWNER_EMAIL}"
      }
    }
  }
}
```

README com o passo a passo e o aviso de que a string do MCP é de uma role
somente-leitura — não reaproveitar a `DATABASE_URL` do app.

### Fase 5 (depois) — MCP remoto multiusuário

Rota `/api/mcp` no próprio Next, transporte HTTP streamable, autenticada pela
sessão do Neon Auth ou por um token pessoal (`api_tokens` ligado a `app_users`).
Aí o `owner_id` sai do token, não de env var, e o mesmo servidor atende todo
mundo. Só faz sentido depois do deploy.

---

## 3. Riscos e limites

- **Credencial local.** `DATABASE_URL_MCP` fica em `.env.local` do dev. Mitigado
  por ser role só-leitura; ainda assim, rotacionável.
- **Sem `users_sync`.** Enquanto `app_users` não estiver populado, o MCP não
  resolve e-mail nenhum. Por isso a Fase 0 vem antes de tudo.
- **Contagem cara.** `fleet_summary` varre `scan_plugins`; se o histórico crescer,
  materializar um resumo por scan (os contadores já estão em `scans`).
- **Deriva de schema.** As queries do MCP vivem no mesmo repo das migrations —
  qualquer alteração de schema quebra o build dos dois juntos, que é o que se quer.

## 4. Ordem de execução

1. Fase 0 (migration + `upsertUser` + role) — sem isso nada funciona.
2. Fase 1 + as três primeiras tools (`list_sites`, `get_site_status`, `list_outdated`).
3. Testar no agente de verdade; só então as cinco tools restantes.
4. Testes da Fase 3 junto com as tools, não depois.
5. Fase 5 só depois do deploy na Vercel.
