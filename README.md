# dash-f2f

Painel **somente leitura** do estado dos plugins de múltiplos sites WordPress,
com login, histórico de varreduras e varredura diária automática.
Next.js 16 (App Router) + TypeScript + Neon (Postgres + Auth).

Cada site monitorado precisa expor:

```
GET {SITE_URL}/wp-json/site-status/v1/plugins
```

devolvendo um array de `{ file, name, version, is_active, has_update, new_version? }`.

---

## Como rodar

```bash
npm install
npm run db:migrate     # cria as tabelas no branch Neon atual
npm run dev            # http://localhost:3000
```

Primeiro acesso: `/auth/sign-up` cria a conta (Neon Auth). A partir daí os sites
ficam no Postgres, ligados ao seu usuário.

Build de produção:

```bash
npm run build
npm start
```

### Variáveis de ambiente

`.env.local` (gerado por `neon init` + este projeto — nunca versionado):

| var | origem | para quê |
|---|---|---|
| `DATABASE_URL` | `neon init` | conexão pooled usada pelo app |
| `DATABASE_URL_UNPOOLED` | `neon init` | conexão direta (migrations/sessão) |
| `NEON_BRANCH` | `neon init` | branch Neon corrente |
| `NEON_AUTH_BASE_URL` | `neon init` | integração Neon Auth |
| `NEON_AUTH_JWKS_URL` | `neon init` | verificação dos tokens |
| `NEON_AUTH_COOKIE_SECRET` | gerado local (≥32 chars) | assina o cookie de sessão |
| `CRON_SECRET` | gerado local | autentica a rota de cron |
| `ALLOW_PRIVATE_HOSTS` | opcional | `1` libera Local WP / intranet |
| `DATABASE_URL_MCP` | `npm run db:reader` | role somente-leitura; exigida pelo MCP (local e remoto) |
| `DASH_F2F_OWNER_EMAIL` | manual | conta exposta pelo MCP **local** (o remoto usa o token) |

Na Vercel: replique todas, exceto `ALLOW_PRIVATE_HOSTS`. `CRON_SECRET` é enviado
automaticamente pela plataforma como `Authorization: Bearer …` nas invocações de
cron — basta existir no projeto.

### Monitorar um WordPress local ou de intranet

Por padrão o servidor recusa hosts internos (`localhost`, `127.x`, `10.x`,
`192.168.x`, `.local`) para não virar um scanner da rede onde o app roda:

```bash
ALLOW_PRIVATE_HOSTS=1 npm run dev
```

---

## O que o painel faz

1. **Login** (Neon Auth) — cada usuário vê só os próprios sites.
2. **Consulta** — o GET no WordPress sai do **servidor**, então não há CORS.
3. **Histórico** — cada consulta grava um `scan` + o snapshot dos plugins.
4. **Diff** — o painel mostra o que mudou desde a varredura anterior
   (novo, removido, atualizado, ativado, desativado, nova atualização) e marca
   as linhas correspondentes na tabela.
5. **Cron diário** — 06:00 UTC, varre todos os sites cadastrados e grava, mesmo
   sem ninguém abrir o painel.

### Por que uma rota de API em vez de fetch no browser

O browser não consegue ler `https://seusite.com/wp-json/...` de outro domínio a
menos que o WordPress devolva cabeçalhos CORS — o que raramente acontece:

```
browser → GET /api/plugins?site=…   (mesma origem, sem CORS)
           └─ servidor → GET https://exemplo.com/wp-json/site-status/v1/plugins
```

---

## Garantia de somente leitura

- `src/lib/wp.ts` é o **único** ponto que sai para o WordPress, e usa
  `method: 'GET'`.
- As rotas expõem apenas `GET`; qualquer outro método responde `405`.
- A UI não tem affordance de escrita: nada de ativar, desativar ou atualizar
  plugin.
- A **escrita existe só no nosso Postgres** (sites, scans, snapshots). Remover
  um site apaga o histórico dele aqui — não toca no WordPress.

Conferência rápida:

```bash
grep -rn "method:" src/
grep -rn "POST\|PUT\|PATCH\|DELETE" src/app/api
```

---

## Arquitetura

```
src/
├─ proxy.ts                    proteção de rotas (Next 16 renomeou middleware → proxy)
├─ app/
│  ├─ page.tsx                 Server Component: sessão + sites do usuário
│  ├─ actions.ts               Server Actions: add/remove site, sign out
│  ├─ auth/sign-in|sign-up/    telas de autenticação (Server Actions)
│  ├─ api/auth/[...path]/      handler do Neon Auth
│  ├─ api/plugins/             consulta + grava scan + devolve diff
│  ├─ api/cron/scan/           varredura diária (Bearer CRON_SECRET)
│  └─ globals.css              design system
├─ components/
│  ├─ Dashboard.tsx            orquestra a interação no cliente
│  ├─ SiteForm · SavedSites · StatsRow · PluginTable · ChangeLog · States
├─ lib/
│  ├─ auth.ts                  instância Neon Auth + helpers de sessão
│  ├─ db.ts                    queries (sempre escopadas por owner_id)
│  ├─ wp.ts                    leitura do WordPress (GET, timeout, normalização)
│  ├─ diff.ts                  comparação entre duas varreduras
│  ├─ plugins.ts               status, filtros, métricas
│  └─ site-url.ts              normalização de URL + bloqueio de host interno
sql/001_init.sql               schema
scripts/migrate.mjs            runner de migrations
```

### Schema

```
sites (id, owner_id, url, label, created_at)         unique (owner_id, url)
scans (id, site_id, fetched_at, ok, error_kind, error_message,
       total, active, outdated, inactive, source)    source: manual | cron
scan_plugins (scan_id, file, name, version, new_version, is_active, has_update)
```

Uma varredura que falhou também vira linha em `scans` — saber quando um site
parou de responder faz parte do histórico.

### Status do plugin

| `is_active` | `has_update` | rótulo |
|---|---|---|
| ✅ | ✅ | Ativo (desatualizado) |
| ✅ | ❌ | Ativo |
| ❌ | ✅ | Inativo (desatualizado) |
| ❌ | ❌ | Inativo |

### Tratamento de erros

| situação | resposta | o que o usuário vê |
|---|---|---|
| sessão ausente | 401 | proxy redireciona para `/auth/sign-in` |
| URL inválida | 400 `invalid_url` | erro no formulário |
| site não é do usuário | 404 `not_found` | "Este site não está na sua lista" |
| endpoint ausente | 404 `not_found` | "Endpoint não encontrado · 404" |
| site fora do ar / timeout | 504 `network` | "Não foi possível ler este site" |
| status ≥ 400 no site | 502 `http` | "O site respondeu com erro" |
| JSON inesperado | 502 `bad_payload` | "Resposta inesperada" |

Nenhuma delas derruba a aplicação, e todas ficam registradas no histórico.

---

## MCP (somente leitura)

O painel expõe seus sites a um assistente por MCP, em dois transportes que
compartilham as mesmas ferramentas e a mesma conexão somente-leitura:

- **Conector remoto** — gere a URL em `/conectores` e cole no Claude, no ChatGPT
  ou em qualquer cliente MCP:
  `https://dash-f2f.vercel.app/api/mcp?token=dashf2f_…`.
  O token identifica a conta, é revogável na mesma tela e registra o último uso.
- **Servidor local (stdio)** — `mcp/`, para Claude Code, Cursor e VS Code.

Ambos leem o banco com a role `dash_f2f_reader`, que só tem `GRANT SELECT`:

```bash
npm run db:reader     # cria a role e grava DATABASE_URL_MCP no .env.local
npm run mcp:build
npm run mcp:test      # 20 testes: isolamento por dono, negação de escrita, handshake real
```

Oito ferramentas (`list_sites`, `get_site_status`, `list_outdated`,
`get_scan_history`, `diff_scans`, `find_plugin`, `fleet_summary`,
`list_failing_sites`), todas escopadas ao usuário de `DASH_F2F_OWNER_EMAIL`.

- **Conectar ao seu agente:** [`docs/conectar-mcp.md`](./docs/conectar-mcp.md)
- **Como funciona por dentro:** [`mcp/README.md`](./mcp/README.md)

## Design

Canvas Doop **dash-f2f — Monitor de Plugins WordPress** (`/c/3DJNtZjiNy`),
style guide `design-system`. Direção *gráfica / carimbo sobre papel quente*:
papel `#F6F3EC`, tinta `#15130F`, hairlines `#E4DED1` e um único acento de
carimbo `#D2451E` reservado ao que exige ação. Schibsted Grotesk + Spline Sans
Mono via `next/font`.
