# dash-f2f

Painel **somente leitura** do estado dos plugins, temas, usuários e settings de
múltiplos sites WordPress, com login, histórico de varreduras e varredura diária
automática. Next.js 16 (App Router) + TypeScript + Neon (Postgres + Auth).

Cada site monitorado precisa ter a REST API nativa do WordPress acessível e uma
[Application Password](https://make.wordpress.org/core/2020/11/05/application-passwords-integration-guide/)
cadastrada no painel (usuário + senha de aplicativo, gerada em wp-admin →
Usuários → Perfil → Senhas de aplicativo). O painel lê `/wp-json/wp/v2/plugins`,
`/themes`, `/users` e `/settings` com essa credencial.

---

## Como rodar

```bash
npm install
npm run db:migrate     # cria as tabelas no branch Neon atual
npm run dev            # http://localhost:3000
```

Primeiro acesso: `/auth/sign-up` cria a conta (Neon Auth) — só e-mails de
`f2f-digital.com` (ou o que estiver em `ALLOWED_EMAIL_DOMAINS`) entram. A
partir daí os sites ficam no Postgres, compartilhados com toda a equipe — ver
[Acesso e usuários](#acesso-e-usuários).

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
| `CREDENTIALS_KEY` | gerado local (32 bytes base64) | cifra as Application Passwords (AES-256-GCM) — gere com `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `ALLOWED_EMAIL_DOMAINS` | opcional (default `f2f-digital.com`) | domínios de e-mail liberados para cadastro e sessão, separados por vírgula — comparação exata, sem subdomínio; vazio cai no default, nunca libera geral |
| `REQUIRE_EMAIL_VERIFIED` | opcional (default desligado) | com `1`, exige `emailVerified: true` para manter a sessão — **ver aviso em [Acesso e usuários](#acesso-e-usuários) antes de ligar** |

Na Vercel: replique todas, exceto `ALLOW_PRIVATE_HOSTS`. `CRON_SECRET` é enviado
automaticamente pela plataforma como `Authorization: Bearer …` nas invocações de
cron — basta existir no projeto.

> **A chave não pode ser perdida nem rotacionada sem plano:** trocar
> `CREDENTIALS_KEY` torna toda credencial já gravada indecifrável, e cada
> cliente precisa cadastrar a Application Password de novo.

### Monitorar um WordPress local ou de intranet

Por padrão o servidor recusa hosts internos (`localhost`, `127.x`, `10.x`,
`192.168.x`, `.local`) para não virar um scanner da rede onde o app roda:

```bash
ALLOW_PRIVATE_HOSTS=1 npm run dev
```

---

## O que o painel faz

1. **Login** (Neon Auth), restrito a e-mails de `f2f-digital.com` — a partir
   daí todo usuário logado vê e gerencia **todos** os sites da equipe, não só
   os que ele mesmo cadastrou.
2. **Consulta** — o GET no WordPress sai do **servidor**, então não há CORS.
3. **Histórico** — cada consulta grava um `scan` + o snapshot dos plugins.
4. **Diff** — o painel mostra o que mudou desde a varredura anterior
   (novo, removido, atualizado, ativado, desativado, nova atualização) e marca
   as linhas correspondentes na tabela.
5. **Cron diário** — 06:00 UTC, varre todos os sites cadastrados e grava, mesmo
   sem ninguém abrir o painel.

### Por que uma rota de API em vez de fetch no browser

O browser não consegue ler `https://seusite.com/wp-json/...` de outro domínio a
menos que o WordPress devolva cabeçalhos CORS — o que raramente acontece. Além
disso, a Application Password nunca pode chegar ao cliente:

```
browser → GET /api/plugins?site=…   (mesma origem, sem CORS, sem credencial)
           └─ servidor → GET https://exemplo.com/wp-json/wp/v2/plugins
                          (Basic auth com a Application Password do site)
```

---

## Garantia de somente leitura

- `src/lib/wp-rest.ts` é o **único** ponto que sai para o WordPress, e todo
  método lá é `GET`.
- As rotas expõem apenas `GET`; qualquer outro método responde `405`.
- A UI não tem affordance de escrita: nada de ativar, desativar ou atualizar plugin.

### O que mudou, e por quê importa

O painel guarda uma Application Password por site. **Essa credencial tem poder de
escrita no WordPress** — o core não oferece Application Password com escopo
reduzido: ela herda todas as capabilities do usuário que a gerou, e ler a lista de
plugins já exige `activate_plugins` (administrador).

Ou seja: a garantia de somente-leitura deixou de ser imposta pela credencial e
passou a ser imposta pelo nosso código. As barreiras são:

1. `src/lib/wp-rest.ts` só faz `GET`, e é o único módulo com a credencial em mãos.
2. A senha é cifrada em AES-256-GCM; a chave (`CREDENTIALS_KEY`) vive fora do banco.
3. A role `dash_f2f_reader`, usada pelo MCP, tem `REVOKE ALL` em `site_credentials`
   — o conector MCP, que é exposto publicamente, não consegue ler credencial.

A role do MCP funciona por allow-list: ela recebe `SELECT` só nas tabelas de
`READ_TABLES` em `scripts/setup-reader-role.mjs`, e tabela nova nasce sem acesso.

A **escrita no nosso Postgres** (sites, credenciais, scans, snapshots) é a única
escrita que o app faz. Remover um site apaga o histórico dele aqui — não toca no
WordPress.

### Cobertura de `has_update`

O core do WordPress não expõe atualização pendente por REST — esse dado vive no
transient `update_plugins`. O painel calcula comparando a versão instalada com a
publicada em `api.wordpress.org`. **Plugin fora do repositório oficial (premium ou
customizado) aparece marcado como "atualização desconhecida"** e nunca é contado
como em dia.

Conferência rápida:

```bash
grep -rn "method:" src/lib/wp-rest.ts
grep -rn "POST\|PUT\|PATCH\|DELETE" src/app/api
```

---

## Acesso e usuários

Desde que os sites passaram a ser da equipe (`sql/011_shared_sites.sql`), quem
consegue logar no painel enxerga e gerencia o inventário de **todos** os
clientes — não só os que cadastrou. Isso torna a barreira de entrada tão
crítica quanto a cifra das credenciais.

A barreira é o domínio do e-mail, `f2f-digital.com` por padrão
(`ALLOWED_EMAIL_DOMAINS`, comparação exata — sem `endsWith`/`includes`/regex
frouxa, sem subdomínio), imposta em três camadas:

1. o formulário de cadastro (`src/app/auth/sign-up/page.tsx`);
2. um wrapper em `POST /api/auth/sign-up/email`
   (`src/app/api/auth/[...path]/route.ts`) — necessário porque a rota crua do
   Neon Auth aceita POST direto, ignorando o formulário;
3. a sessão — `currentUser()` em `src/lib/auth.ts` devolve `null` para sessão
   fora do domínio, antes até de espelhar o usuário em `app_users`. Esta é a
   camada que garante de fato: contas podem ser criadas por fora do app
   inteiro, direto contra a base URL do Neon Auth (confirmado em teste), e
   `POST /api/auth/sign-in/social` já está montado (responde
   `PROVIDER_NOT_SUPPORTED`) — bastaria habilitar um provedor social no
   console do Neon para abrir um caminho de criação de conta que o filtro do
   cadastro nunca veria.

> **Restrição de domínio sem verificação de e-mail não prova que alguém é
> dono do endereço.** Qualquer pessoa registra `inventado@f2f-digital.com`
> direto contra o Neon Auth. Antes do compartilhamento, uma conta forjada
> assim não via nada; **com os sites compartilhados, uma conta
> `@f2f-digital.com` não verificada enxerga o inventário de todos os clientes
> e pode remover sites e trocar credenciais.**
>
> Por isso verificação de e-mail é bloqueio de deploy para este modelo:
> configure o Neon Auth para enviar e-mail de verificação, verifique as contas
> existentes, e só depois ligue `REQUIRE_EMAIL_VERIFIED=1`
> (`src/lib/auth.ts`, desligado por padrão). Ligar antes disso tranca a
> equipe inteira para fora — as duas contas atuais têm `emailVerified: false`.

Os tokens do conector MCP continuam individuais (um por usuário, para
atribuição e revogação isolada), mas um token válido lê os dados da equipe
inteira, e `ownerForToken` (`src/lib/tokens.ts`) também recusa token cujo dono
não esteja mais num domínio permitido — ver [MCP](#mcp-somente-leitura).

Remover um site pede confirmação na UI: a ação apaga o site, seu histórico e
sua credencial para todo mundo, não só para quem está removendo. A lista de
sites mostra quem cadastrou cada um (`sites.added_by`).

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
│  ├─ auth.ts        instância Neon Auth + helpers de sessão
│  ├─ db.ts          queries — sites são da equipe inteira (sem escopo por dono); tokens continuam escopados por dono
│  ├─ wp-rest.ts      único ponto de saída para o WordPress (GET, timeout, normalização)
│  ├─ wporg.ts        versão publicada de cada plugin em api.wordpress.org, com cache
│  ├─ inventory.ts    junta o inventário do WordPress com as versões do wordpress.org
│  ├─ crypto.ts       cifra/decifra a Application Password (AES-256-GCM)
│  ├─ credentials.ts  leitura/gravação da credencial de cada site
│  ├─ version.ts      comparação de versões no estilo WordPress
│  ├─ diff.ts         comparação entre duas varreduras
│  ├─ plugins.ts      status, filtros, métricas
│  └─ site-url.ts     normalização de URL + bloqueio de host interno
sql/001_init.sql               schema inicial (mais migrations incrementais em sql/)
scripts/migrate.mjs            runner de migrations
scripts/setup-reader-role.mjs  cria/atualiza a role somente-leitura do MCP
```

### Schema

```
sites (id, added_by, url, label, created_at)          unique (url)
site_credentials (site_id PK, wp_user, password_cipher,
                   created_at, updated_at, last_verified_at, last_error)
scans (id, site_id, fetched_at, ok, error_kind, error_message,
       total, active, outdated, inactive, source)    source: manual | cron
scan_plugins (scan_id, file, name, version, new_version, is_active, has_update,
              update_source)                          update_source: site | wporg | unknown
scan_themes (scan_id, stylesheet, name, version, is_active)
scan_users (scan_id, wp_user_id, slug, name, roles)
scan_settings (scan_id, title, description, url, admin_email, timezone, language)
wporg_versions (slug PK, latest_version, checked_at)  cache compartilhado, dado público
```

Uma varredura que falhou também vira linha em `scans` — saber quando um site
parou de responder faz parte do histórico. `site_credentials` guarda no máximo
uma credencial por site (`site_id` é a própria PK). `sites.added_by` registra
quem cadastrou o site, mas não escopa nada — é só atribuição, e a listagem
(`unique (url)`) é a mesma para toda a equipe.

### Status do plugin

| `is_active` | `has_update` | rótulo |
|---|---|---|
| ✅ | ✅ | Ativo (desatualizado) |
| ✅ | ❌ | Ativo |
| ❌ | ✅ | Inativo (desatualizado) |
| ❌ | ❌ | Inativo |

Quando `update_source` é `'unknown'` (plugin fora do wordpress.org), a UI mostra
"atualização desconhecida" em vez de tratar o plugin como em dia — ver
[Cobertura de `has_update`](#cobertura-de-has_update).

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
| site sem credencial cadastrada | 400 `no_credential` | "Site sem credencial" |
| credencial gravada não decifra | 400 `bad_credential` | "Credencial ilegível" — pede novo cadastro |
| WordPress recusa a Application Password | 401 `unauthorized` | "Credencial recusada · 401" |
| usuário sem `activate_plugins` no WP | 403 `forbidden` | "Sem permissão · 403" |

Nenhuma delas derruba a aplicação, e todas ficam registradas no histórico.

---

## MCP (somente leitura)

O painel expõe seus sites a um assistente por MCP, em dois transportes que
compartilham as mesmas ferramentas e a mesma conexão somente-leitura:

- **Conector remoto** — gere a URL em `/conectores` e cole no Claude, no ChatGPT
  ou em qualquer cliente MCP:
  `https://dash-f2f.vercel.app/api/mcp?token=dashf2f_…`.
  O token é **individual** — pessoal, atribuível a quem o gerou e revogável só
  por essa conta, na mesma tela, que também registra o último uso.
- **Servidor local (stdio)** — `mcp/`, para Claude Code, Cursor e VS Code.

O token é individual, mas o **dado é da equipe inteira**: sites são
compartilhados (`sql/011_shared_sites.sql`), então qualquer token válido lê o
mesmo inventário completo, não só o de quem o criou. `ownerForToken`
(`src/lib/tokens.ts`) revalida a cada uso que o dono do token continua num
domínio permitido — token de conta fora do domínio para de funcionar mesmo
sem ser revogado.

Ambos leem o banco com a role `dash_f2f_reader`, que só tem `GRANT SELECT`:

```bash
npm run db:reader     # cria a role e grava DATABASE_URL_MCP no .env.local
npm run mcp:build
npm run mcp:test      # 28 testes: negação de escrita, handshake real, escopo do token
```

Dez ferramentas (`list_sites`, `get_site_status`, `list_outdated`,
`get_scan_history`, `diff_scans`, `find_plugin`, `fleet_summary`,
`list_failing_sites`, `get_site_themes`, `get_site_users`), lendo o inventário
completo da equipe — a conta (via token ou `DASH_F2F_OWNER_EMAIL`) só serve
para identificar quem está perguntando, não para filtrar o que a tool devolve.

- **Conectar ao seu agente:** [`docs/conectar-mcp.md`](./docs/conectar-mcp.md)
- **Como funciona por dentro:** [`mcp/README.md`](./mcp/README.md)

## Design

Canvas Doop **dash-f2f — Monitor de Plugins WordPress** (`/c/3DJNtZjiNy`),
style guide `design-system`. Direção *gráfica / carimbo sobre papel quente*:
papel `#F6F3EC`, tinta `#15130F`, hairlines `#E4DED1` e um único acento de
carimbo `#D2451E` reservado ao que exige ação. Schibsted Grotesk + Spline Sans
Mono via `next/font`.
