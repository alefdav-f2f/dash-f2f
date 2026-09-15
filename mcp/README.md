# dash-f2f MCP

Servidor MCP (stdio) que expõe, para um agente, os sites monitorados no dash-f2f
e o histórico de varreduras de plugins — **somente leitura**.

As ferramentas vivem em `src/lib/mcp/tools.ts`, compartilhadas com o conector
remoto (`/api/mcp`, autenticado por token gerado em `/conectores`). Este pacote
é só o transporte stdio: resolve a conta por `DASH_F2F_OWNER_EMAIL` e liga o
servidor à entrada/saída padrão.

## Garantia de somente leitura

Três camadas independentes:

1. **Banco** — o servidor conecta com a role `dash_f2f_reader`, que tem
   `GRANT SELECT` nas quatro tabelas e nada mais. `INSERT`/`UPDATE`/`DELETE`
   respondem `permission denied` (coberto por teste).
2. **Consultas** — SQL fixo e parametrizado em `src/queries.ts`. Não existe tool
   que aceite SQL do agente.
3. **Protocolo** — toda tool é anotada com `readOnlyHint: true`.

Além disso, o WordPress não é tocado: o MCP lê o banco do painel, nunca os sites.

## Escopo por usuário

`DASH_F2F_OWNER_EMAIL` define de quem são os dados. O servidor resolve esse
e-mail para o `owner_id` **uma vez, no boot**, e injeta esse id em todas as
queries. Nenhuma tool aceita dono por parâmetro — o agente não consegue pedir os
dados de outra conta (coberto por teste de isolamento).

O e-mail precisa existir em `app_users`, tabela preenchida no primeiro acesso
autenticado ao painel.

> **Como conectar em Claude Code, Claude Desktop, Cursor ou VS Code:**
> [`docs/conectar-mcp.md`](../docs/conectar-mcp.md).

## Configuração

```bash
npm install
npm run db:migrate    # cria as tabelas, inclusive app_users
npm run db:reader     # cria a role read-only e grava DATABASE_URL_MCP no .env.local
npm run mcp:build     # compila para mcp/dist
npm run mcp:test      # 20 testes: isolamento, negação de escrita e handshake real
```

Depois adicione o e-mail da conta no `.env.local`:

```
DASH_F2F_OWNER_EMAIL=voce@exemplo.com
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
└─ test/                  isolamento · negação de escrita · handshake · conector remoto

src/lib/mcp/              compartilhado com /api/mcp
├─ tools.ts               as 8 ferramentas
├─ queries.ts             SQL, sempre com owner_id
└─ db.ts                  conexão read-only + resolveOwnerId
```

O build espelha a árvore do repo (`dist/mcp/src/…` e `dist/src/lib/…`) porque o
servidor reaproveita `src/lib/diff.ts` e `src/lib/site-url.ts` do painel — a
mesma regra de diff e a mesma normalização de URL, sem duplicação.
