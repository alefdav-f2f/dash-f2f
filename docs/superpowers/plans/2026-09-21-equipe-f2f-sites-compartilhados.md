# Equipe F2F — domínio restrito e sites compartilhados — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Transformar o painel de multi-inquilino (cada usuário com seus sites) em
ferramenta de equipe: só entra quem tem e-mail `@f2f-digital.com`, e todos veem e
gerenciam todos os sites.

**Architecture:** O `owner_id` deixa de particionar dados e vira registro de quem
cadastrou o site (`added_by`). A autenticação continua obrigatória em tudo — o que
muda é que, depois de autenticado e do domínio certo, não há mais recorte por
usuário. Tokens do conector MCP continuam individuais (para saber de quem é e revogar
um por um), mas leem os dados da equipe inteira.

**Pedido do usuário (2026-09-21):** "só devemos aceitar emails f2f-digital.com e
todos os sites devem ser compartilhados entre os usuários".

---

## O risco que a combinação cria — ler antes de tudo

As duas mudanças são razoáveis separadas. **Juntas, sem verificação de e-mail, abrem
um buraco que hoje não existe.**

- Restringir por domínio só funciona se o e-mail for **verificado**. Sem isso, qualquer
  pessoa se cadastra como `inventado@f2f-digital.com` — nada confere se a caixa existe.
  As duas contas atuais têm `emailVerified: false`.
- O cadastro não passa só pelo formulário: `POST /api/auth/sign-up/email` é exposto
  pelo handler do Neon Auth e aceita cadastro direto (foi assim que a conta
  `desenvolvimento@` foi criada). Bloquear só no formulário é contornável.
- **Hoje** uma conta falsa não vê nada: cada usuário só enxerga os próprios sites.
  **Depois do compartilhamento**, uma conta falsa `@f2f-digital.com` vê o inventário
  de todos os clientes e pode apagar sites e trocar credenciais.

**Mitigação neste plano:** domínio checado em três camadas — formulário (UX),
interceptação do POST de cadastro na nossa rota, e **na sessão** (a garantia real:
quem criar conta pelo caminho cru não consegue usá-la).

**O que este plano NÃO resolve:** verificação de e-mail. Ela é configuração do Neon
Auth, não do nosso código, e exigir `emailVerified` sem o envio funcionando tranca
as duas contas atuais para fora. Fica pronta para ligar (Task 3 deixa o ponto de
extensão), e **vira bloqueio de deploy**: não publicar compartilhamento em produção
antes de o Neon estar enviando verificação.

---

## Decisões

| # | Decisão | Motivo |
|---|---|---|
| A | Compartilhamento **total**: todos veem e gerenciam tudo | Pedido literal; ferramenta interna de agência, time pequeno |
| B | `sites.owner_id` → `added_by` | Coluna que não significa mais "dono" com nome de dono engana quem lê |
| C | `UNIQUE (owner_id, url)` → `UNIQUE (url)` | Compartilhado, o mesmo site não pode existir duas vezes |
| D | Tokens MCP seguem por usuário | Saber de quem é cada token e revogar individualmente |
| E | Domínio em três camadas, sessão como garantia | Formulário e API de cadastro são contornáveis; sessão não |
| F | Domínio configurável por env, default `f2f-digital.com` | Sem constante enterrada no código |

---

## Tasks

### Task 1: Regra de domínio (TDD, puro)

**Files:** `src/lib/allowed-email.ts`, `src/lib/allowed-email.test.ts`

`isAllowedEmail(email: string | null | undefined): boolean`. Lê a lista de
`ALLOWED_EMAIL_DOMAINS` (separada por vírgula), default `f2f-digital.com`.

Casos obrigatórios — **o valor desta task está nos casos de ataque**:
- `alef@f2f-digital.com` → true; `ALEF@F2F-DIGITAL.COM` → true (case-insensitive)
- `x@evil.com` → false
- `x@f2f-digital.com.evil.com` → false (sufixo)
- `x@evilf2f-digital.com` → false (colado)
- `x@sub.f2f-digital.com` → **false** (subdomínio não é o domínio; decidir e documentar)
- `x@f2f-digital.com@evil.com`, `"x@f2f-digital.com"@evil.com` → false
- vazio, null, sem `@` → false
- espaços nas pontas → tratar ou recusar, decidir e documentar

Compare o domínio **inteiro** depois do último `@`, nunca com `endsWith`/`includes`.

### Task 2: Bloquear cadastro fora do domínio

**Files:** `src/app/auth/sign-up/page.tsx`, `src/app/api/auth/[...path]/route.ts`

- Formulário: checa antes de chamar `auth.signUp.email`, com mensagem clara.
- Rota: envolve o `POST` do `auth.handler()` para, **só nos caminhos de cadastro**,
  ler o corpo, recusar domínio fora da lista com 403, e repassar o resto intacto.
  Atenção: o corpo de um `Request` só pode ser lido uma vez — clonar antes.
- Prova: `curl -X POST /api/auth/sign-up/email` com `x@evil.com` → 403, e **nenhum
  usuário criado**.

### Task 3: A sessão como garantia

**Files:** `src/lib/auth.ts`, `src/proxy.ts`

`currentUser()` devolve `null` para sessão cujo e-mail não passa em `isAllowedEmail`.
Isso cobre conta criada por qualquer caminho, inclusive antes desta regra existir.

Deixar o ponto de extensão para verificação de e-mail explícito — uma constante ou
env `REQUIRE_EMAIL_VERIFIED` desligada por padrão, com comentário dizendo **por que**
está desligada e o que precisa estar pronto no Neon antes de ligar.

Prova: uma conta fora do domínio, criada direto no Neon Auth, não consegue abrir o
painel nem chamar `/api/plugins`.

### Task 4: Migração de posse para autoria

**Files:** `sql/012_shared_sites.sql`

```sql
ALTER TABLE sites RENAME COLUMN owner_id TO added_by;
ALTER TABLE sites DROP CONSTRAINT IF EXISTS sites_owner_id_url_key;
ALTER TABLE sites ADD CONSTRAINT sites_url_key UNIQUE (url);
```

**Antes:** conferir que não há URL duplicada entre donos — se houver, a constraint
falha. Conferir o nome real da constraint antiga em `pg_constraint`, não presumir.
O índice `sites_owner_idx` referencia a coluna renomeada; avaliar se ainda serve.

### Task 5: Dados sem recorte por dono

**Files:** `src/lib/db.ts`, `src/lib/credentials.ts`, `src/app/page.tsx`, `src/app/actions.ts`, rotas

Toda query que filtrava `WHERE owner_id = ${ownerId}` em `sites`/`site_credentials`
passa a não filtrar. `addSite` grava `added_by`. Autenticação continua exigida em
todos os pontos de entrada — **remover o filtro não é remover o `requireUser()`**.

`api_tokens` **não muda**: token continua pertencendo a um usuário.

### Task 6: MCP lendo dados da equipe

**Files:** `src/lib/mcp/queries.ts`, `src/lib/mcp/tools.ts`, `src/app/api/mcp/route.ts`, `mcp/src/server.ts`, `src/lib/tokens.ts`, `mcp/test/*`

- Queries param de escopar por dono.
- `ownerForToken` passa a exigir que o dono do token seja de domínio permitido —
  token de conta fora do domínio para de funcionar.
- **Os testes de isolamento codificam o requisito antigo** ("A não vê B"). Reescrever
  para o requisito novo, e isso é mudança de propriedade de segurança, não conserto
  de teste:
  - usuário autorizado vê todos os sites
  - token revogado não vê nada
  - token de usuário fora do domínio não vê nada
  - a role do MCP continua sem ler `site_credentials` e `api_tokens`

### Task 7: UI de equipe

**Files:** `src/components/SavedSites.tsx`, `src/components/Dashboard.tsx`

- Remover site agora apaga o histórico **para todo mundo**: exigir confirmação
  explícita dizendo isso.
- Mostrar quem cadastrou cada site (`added_by` → e-mail via `app_users`).

### Task 8: Decisão registrada

ADR **D-011** em `decisoes.md` superando o modelo multi-inquilino, README (seção de
usuários e o risco da verificação), vault.

---

## Depois deste plano

Retomar a Fase 4 (`2026-09-20-fase-4-saude-e-atividade.md`), Tasks 12, 13, 14, 14b e
15 — agora sobre o modelo compartilhado. A Task 14 em particular (`list_unhealthy_sites`)
fica mais simples: "todos os sites da conta" vira "todos os sites".
