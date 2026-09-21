# dash-f2f MCP

Servidor MCP (stdio) que expõe, para um agente, os sites monitorados no dash-f2f
e o histórico de varreduras de plugins — **somente leitura**.

As ferramentas vivem em `src/lib/mcp/tools.ts`, compartilhadas com o conector
remoto (`/api/mcp`, autenticado por token gerado em `/conectores`). Este pacote
é só o transporte stdio: valida a conta de `DASH_F2F_OWNER_EMAIL` e liga o
servidor à entrada/saída padrão.

## Garantia de somente leitura

Três camadas independentes:

1. **Banco** — o servidor conecta com a role `dash_f2f_reader`, que recebe
   `GRANT SELECT` só nas tabelas de `READ_TABLES` em
   `scripts/setup-reader-role.mjs` — allow-list: tabela nova nasce sem acesso.
   `INSERT`/`UPDATE`/`DELETE` respondem `permission denied`, e `site_credentials`
   e `api_tokens` ficam fora da lista (tudo coberto por teste).
2. **Consultas** — SQL fixo e parametrizado em `src/lib/mcp/queries.ts`. Não
   existe tool que aceite SQL do agente.
3. **Protocolo** — toda tool é anotada com `readOnlyHint: true`.

Além disso, o WordPress não é tocado: o MCP lê o banco do painel, nunca os sites.

## Quem pode usar, e o que enxerga

Os sites são **da equipe**: todo usuário autorizado vê todos. Por isso o MCP não
recorta dados por conta — ele confere **quem pode entrar**.

- **stdio:** `DASH_F2F_OWNER_EMAIL` é validado no boot. Precisa existir em
  `app_users` (preenchida no primeiro acesso autenticado ao painel) e ser de um
  domínio permitido (`ALLOWED_EMAIL_DOMAINS`, padrão `f2f-digital.com`). Fora
  disso o servidor não sobe.
- **remoto:** cada token pertence a um usuário, para dar para saber de quem é e
  revogar um por um. Token revogado, ou de dono fora do domínio, não vê nada —
  e o domínio é reconferido a cada uso, não só na criação do token.

Isso substituiu o isolamento por dono que existia até 2026-09-21 ("a conta A não
vê a conta B"), que deixou de ser requisito quando os sites viraram compartilhados.
Os testes de `mcp/test/isolation.test.mjs` provam a propriedade nova.

> **Como conectar em Claude Code, Claude Desktop, Cursor ou VS Code:**
> [`docs/conectar-mcp.md`](../docs/conectar-mcp.md).

## Configuração

```bash
npm install
npm run db:migrate    # cria as tabelas, inclusive app_users
npm run db:reader     # cria a role read-only e grava DATABASE_URL_MCP no .env.local
npm run mcp:build     # compila para mcp/dist
npm run mcp:test      # 28 testes: acesso por domínio e token, negação de escrita, handshake real
```

Depois adicione o e-mail da conta no `.env.local` — de um domínio permitido, ou o
servidor recusa no boot:

```
DASH_F2F_OWNER_EMAIL=voce@f2f-digital.com
```

O `.mcp.json` na raiz do repo já aponta para o build e **não declara credencial**:
o servidor lê o `.env.local` do projeto sozinho (subindo diretórios a partir do
build), porque nenhum cliente MCP lê arquivos `.env`. Variável já presente no
ambiente sempre vence, então declarar `env` na config continua servindo para
apontar outra conta ou outro banco.

> Use **sempre** a string da role read-only. A `DATABASE_URL` do app tem
> permissão de escrita e não deve chegar ao MCP.

## Ferramentas

| tool | entrada | o que devolve |
|---|---|---|
| `list_sites` | — | sites da conta + resumo da última varredura |
| `get_site_status` | `site_url` | inventário completo de plugins na última varredura ok |
| `list_outdated` | `site_url?` | plugins com atualização pendente (um site ou a conta toda) |
| `get_scan_history` | `site_url`, `limit?` (≤50) | varreduras, da mais recente para a mais antiga |
| `diff_scans` | `site_url`, `from_scan_id?`, `to_scan_id?` | o que mudou entre duas varreduras |
| `find_plugin` | `plugin`, `only_outdated?` | em quais sites um plugin está e em que versão |
| `fleet_summary` | — | panorama: sites, pendências, falhas, plugins mais recorrentes |
| `list_failing_sites` | — | sites cuja última varredura falhou, com o erro |

Cada resposta traz um resumo em texto e o JSON completo.

## Estrutura

```
mcp/
├─ bin/dash-f2f-mcp.cjs   entrada (esconde o caminho do build)
├─ src/server.ts          transporte stdio
├─ src/env.ts             carrega o .env.local do projeto
└─ test/                  acesso por domínio e token · negação de escrita · handshake · conector remoto

src/lib/mcp/              compartilhado com /api/mcp
├─ tools.ts               as ferramentas (somente leitura)
├─ queries.ts             SQL fixo e parametrizado; sites da equipe, sem recorte por dono
└─ db.ts                  conexão read-only + resolveOwnerId (valida o domínio no boot)
```

O build espelha a árvore do repo (`dist/mcp/src/…` e `dist/src/lib/…`) porque o
servidor reaproveita `src/lib/diff.ts` e `src/lib/site-url.ts` do painel — a
mesma regra de diff e a mesma normalização de URL, sem duplicação.
