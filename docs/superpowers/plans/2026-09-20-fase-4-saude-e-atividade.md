# Fase 4 — Saúde do site e atividade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Extrair tudo o que a Application Password já destrava e que o painel ainda ignora — saúde do site, atualização de tema, mudanças de usuário/configuração e atividade de conteúdo — **sem instalar nada em site de cliente**.

**Architecture:** Nada de novo no WordPress. Três fontes já disponíveis: o namespace `wp-site-health/v1` do core, a API de temas do wordpress.org (espelho da de plugins, já implementada), e diffs entre varreduras consecutivas que já guardamos. O princípio que governa a Fase 1 continua valendo: **nunca afirmar o que o dado não sustenta.**

**Tech Stack:** Next.js 16 App Router, TypeScript, React 19, Neon Postgres, Vitest.

---

## Por que esta fase existe

A Fase 1 trocou a fonte de dados; a Fase 2 ampliou o inventário. Nenhuma das duas tocou no que o core expõe além de CRUD de conteúdo. Enumerando as 133 rotas do WordPress 6.x contra uma instância real, três coisas apareceram:

1. **`wp-site-health/v1`** responde com a mesma credencial e entrega diagnóstico operacional que nenhuma outra fonte dá.
2. A **API de temas** do wordpress.org tem a mesma forma da de plugins, então `has_update` de tema é código já escrito esperando ser ligado.
3. O core **não tem log de atividade** — mas nós tiramos foto do estado a cada varredura, e comparar fotos responde boa parte das mesmas perguntas.

### Fatos verificados contra WordPress real (não presumir, já foi conferido)

- `GET /wp-json/wp-site-health/v1/tests/<test>` com Basic auth devolve
  `{ test, status, label, badge: { label, color }, description (HTML), actions (HTML) }`.
  `status` ∈ `good | recommended | critical`.
- Testes disponíveis: `authorization-header`, `background-updates`, `dotorg-communication`,
  `https-status`, `loopback-requests`, `page-cache`.
- `GET /wp-json/wp-site-health/v1/directory-sizes` **falhou com 500 `not_available`** na
  instância de teste (SQLite). Não sabemos se funciona em MySQL real — tratar como
  best-effort e nunca deixar derrubar a varredura.
- API de temas: `https://api.wordpress.org/themes/info/1.1/?action=theme_information&request[slug]=<slug>`
  devolve JSON com `version` quando existe, e **`false` com HTTP 404** quando não —
  mesma forma que a de plugins, que `parseWporgResponse` já trata.
- `/wp/v2/posts?context=edit&orderby=modified&order=desc` devolve `author` (id) e `modified`.

### O que NÃO é possível, e não deve ser prometido

Login, tentativa de login falha, ativação/desativação de plugin, mudança de configuração
e edição de arquivo **não são registrados pelo core**. Esta fase entrega *detecção de
mudança entre varreduras*, não log de evento. A UI e o MCP precisam dizer isso com
essas palavras — vender diff como auditoria seria repetir o defeito que a Fase 1 passou
o tempo todo corrigindo.

---

## Blocos

| Bloco | Tasks | Entrega |
|---|---|---|
| 1 — Saúde do site | 1–5 | Diagnóstico operacional + causa real do 401 |
| 2 — Atualização de tema | 6–8 | `has_update` de tema, mesmo motor dos plugins |
| 3 — Mudanças entre varreduras | 9–11 | Diff de usuários, temas e settings |
| 4 — Atividade de conteúdo | 12–13 | Últimos conteúdos alterados, com autor |
| 5 — MCP e documentação | 14–15 | Tools novas, README, vault |

Cada bloco é entregável sozinho. Bloco 1 tem o maior retorno e resolve uma pendência
de diagnóstico já aberta.

---

## Bloco 1 — Saúde do site

### Task 1: Schema

**Files:** Create `sql/008_site_health.sql`

```sql
-- Resultado dos testes de Site Health do core, por varredura.
-- O core não expõe isso em lote: é uma rota por teste, então guardamos linha a linha.
-- `status` é o vocabulário do próprio WordPress: good | recommended | critical.

CREATE TABLE IF NOT EXISTS scan_health (
  scan_id     uuid NOT NULL REFERENCES scans (id) ON DELETE CASCADE,
  test        text NOT NULL,
  status      text NOT NULL,
  label       text NOT NULL DEFAULT '',
  badge       text NOT NULL DEFAULT '',
  PRIMARY KEY (scan_id, test)
);
```

Não guardamos `description`/`actions`: são blocos de HTML do WordPress, longos, e a
UI do painel não vai renderizar HTML de terceiro. O `label` já diz o que importa.

- [ ] `npm run db:migrate` → `✓ 008_site_health.sql (1 statements)`
- [ ] Acrescentar `'scan_health'` a `READ_TABLES` em `scripts/setup-reader-role.mjs`, rodar `npm run db:reader`, e **provar** que o reader lê `scan_health` e continua negado em `site_credentials`.
- [ ] Commit: `feat: add site health snapshot table`

---

### Task 2: Leitura dos testes de saúde (TDD)

**Files:** Create `src/lib/wp-health.ts`, `src/lib/wp-health.test.ts`

Tipos em `src/lib/types.ts`:

```ts
export type HealthStatus = 'good' | 'recommended' | 'critical' | 'unknown';

export type HealthCheck = {
  test: string;
  status: HealthStatus;
  label: string;
  badge: string;
};
```

`src/lib/wp-health.ts` exporta:

- `HEALTH_TESTS` — a lista dos seis testes, como constante.
- `normalizeHealth(test, raw): HealthCheck` — puro. Status fora do vocabulário do
  WordPress vira `'unknown'`, **nunca** `'good'`. Um teste que respondeu lixo não é
  um teste que passou.
- `fetchSiteHealth(site, credential): Promise<HealthCheck[]>` — chama os seis em
  paralelo via `wpGet`, e **um teste que falha não derruba os outros**: ele entra no
  resultado com `status: 'unknown'` e um label dizendo que não foi possível verificar.

Testes obrigatórios:
- resposta boa vira `HealthCheck` com badge achatado
- `status` desconhecido (`"weird"`) vira `'unknown'`, não `'good'`
- um teste com 500 não impede os outros cinco de voltarem
- 403 em todos devolve seis `unknown`, não lista vazia (lista vazia pareceria "site saudável")

Gate: `npm test` puro, sem env file.

- [ ] Commit: `feat: read core site health checks`

---

### Task 3: Persistir e ligar no coletor

**Files:** `src/lib/db.ts`, `src/lib/wp-rest.ts`, `src/lib/types.ts`, ambas as rotas

- `SiteInventory` ganha `health: HealthCheck[]`.
- `collectInventory` chama `fetchSiteHealth` dentro do mesmo `attempt('health', …)`
  que já protege temas/usuários/settings.
- `saveInventoryExtras` grava em `scan_health`; `scanHealth(scanId)` lê de volta.
- Resposta da rota carrega `health`.

Gate: `tsc`, `npm test`, `npm run build`, e um round-trip real no banco com limpeza.

- [ ] Commit: `feat: persist site health with each scan`

---

### Task 4: Saúde na UI

**Files:** `src/components/InventoryTabs.tsx` (ou componente novo), `src/app/globals.css`

Uma aba **Saúde** com os seis testes, cada um com seu status. Vocabulário visual: use
o acento (`--red`) só para `critical`; `recommended` é atenção, não alarme; `unknown`
precisa ler como "não verificamos", igual ao selo de cobertura dos plugins.

Regra que não pode ser quebrada: `unknown` **nunca** pode parecer `good`.

Se houver algum `critical`, o cabeçalho do site deve sinalizar — um site que responde
mas não consegue se atualizar está quebrado de um jeito que a contagem de plugins não
mostra.

- [ ] Commit: `feat: show site health tab`

---

### Task 5: O 401 passa a dizer a causa

**Files:** `src/components/States.tsx`, `src/app/api/plugins/route.ts`

Hoje um 401 devolve "Credencial recusada" e uma copy que **lista duas causas possíveis**
sem saber qual é. O teste `authorization-header` sabe.

Quando a varredura falhar com `unauthorized`, tente esse teste isolado (ele não exige
autenticação bem-sucedida para ser informativo — se o header está sendo descartado, é
exatamente isso que ele reporta). Se apontar problema no header, a tela deve dizer que
o servidor está descartando `Authorization` e que a correção é uma regra no `.htaccess`
— em vez de sugerir que a senha pode estar errada.

Se não for possível determinar, mantenha a copy atual. **Não adivinhe.**

- [ ] Commit: `feat: diagnose 401 with the authorization-header check`

---

## Bloco 2 — Atualização de tema

### Task 6: Consulta de versão de tema (TDD)

**Files:** `src/lib/wporg.ts`, `src/lib/wporg.test.ts`

A API de temas tem URL diferente da de plugins mas mesma semântica. Generalize sem
quebrar o que existe:

```ts
const PLUGIN_ENDPOINT = 'https://api.wordpress.org/plugins/info/1.0/';
const THEME_ENDPOINT = 'https://api.wordpress.org/themes/info/1.1/';
```

`fetchThemeFromWporg(slug)` devolve o mesmo `Lookup` discriminado (`{ known: true, version }`
vs `{ known: false }`) — **a distinção entre "não existe no repositório" e "não consegui
consultar" vale para temas exatamente como vale para plugins**, e pela mesma razão: um
timeout gravado como `null` viraria "tema fora do repositório" por 12 horas.

`latestThemeVersions(slugs)` espelha `latestVersions`, usando a mesma tabela de cache com
uma coluna nova que separa os dois espaços de nome (um slug pode existir nos dois).

Migration: `sql/009_wporg_kind.sql` — `wporg_versions` ganha `kind text NOT NULL DEFAULT 'plugin'`
e a PK passa a ser `(kind, slug)`.

Testes: 200 com versão, 404 → `known: true, version: null`, 500 → `known: false`.

- [ ] Commit: `feat: look up theme versions on wordpress.org`

---

### Task 7: Tema ganha veredito de atualização

**Files:** `src/lib/types.ts`, `src/lib/inventory.ts`, `src/lib/wp-rest.ts`, `sql/010_theme_update.sql`, `src/lib/db.ts`

`Theme` ganha `has_update`, `new_version`, `update_source` — mesmos campos e mesma
semântica de `Plugin`. `mergeThemeVersions` espelha `mergePluginVersions`, incluindo o
uso de `isComparableVersion`.

Slug de tema é o `stylesheet` — não há o problema de `plugin_uri` aqui, porque o
stylesheet é o nome do diretório e é isso que o repositório usa. Registre esse raciocínio
em comentário para ninguém "consertar" depois.

Migration acrescenta as três colunas a `scan_themes`, com `update_source` default
`'unknown'` (diferente de `scan_plugins`, que usou `'site'`: aqui o histórico nunca teve
veredito nenhum, então `'unknown'` é o rótulo honesto).

- [ ] Commit: `feat: compute theme update status`

---

### Task 8: Temas desatualizados na UI

**Files:** `src/components/InventoryTabs.tsx`, `src/components/StatsRow.tsx`

A aba Temas passa a mostrar versão nova e o selo de cobertura desconhecida, igual à de
plugins. Decidir e justificar: o contador de "atualização pendente" no topo deve somar
temas, ou manter só plugins com um número separado? Tema desatualizado é risco de
segurança igual, mas misturar muda o significado de um número que já existe.

- [ ] Commit: `feat: surface outdated themes`

---

## Bloco 3 — Mudanças entre varreduras

### Task 9: Diff além de plugins (TDD)

**Files:** `src/lib/diff.ts`, `src/lib/diff.test.ts`

`diffScans` hoje é específico de plugin. Acrescente, sem quebrá-lo:

- `diffUsers(current, previous)` → conta nova, conta removida, papel mudado.
  **Elevação a `administrator` merece tipo próprio** — é o evento de segurança que
  justifica a feature.
- `diffThemes(current, previous)` → tema novo, removido, versão mudou, ativação mudou.
- `diffSettings(current, previous)` → campo a campo, com valor antes/depois.
  `admin_email` e `url` mudando são os que importam.

Tudo puro, tudo com teste. Primeira varredura (previous vazio) devolve vazio, como já
faz `diffScans` — não inventar "tudo é novo" na estreia.

- [ ] Commit: `feat: diff users, themes and settings between scans`

---

### Task 10: Ligar na rota

**Files:** `src/app/api/plugins/route.ts`, `src/lib/db.ts`, `src/lib/types.ts`

A rota já carrega a varredura anterior para o diff de plugins. Carregue também
`scanUsers`/`scanThemes`/`scanSettings` da anterior e devolva os três diffs novos.

Atenção ao custo: são três SELECTs a mais por varredura manual. Aceitável; mas se a
varredura anterior falhou, não há o que comparar — o código já trata isso para plugins,
siga o mesmo caminho.

- [ ] Commit: `feat: return user, theme and settings changes from the scan route`

---

### Task 11: Mudanças na UI

**Files:** `src/components/ChangeLog.tsx`, `src/app/globals.css`

O `ChangeLog` hoje lista mudanças de plugin. Passe a agrupar por tipo de recurso.

**Copy obrigatória:** o bloco precisa deixar explícito que isso é comparação entre duas
varreduras, não registro de quem fez. Algo como *"mudou entre a varredura de X e a de Y
— o WordPress não registra quem fez"*. Sem isso, um usuário razoavelmente conclui que o
painel tem auditoria, e ele não tem.

Elevação a administrador deve ser visualmente distinta do resto.

- [ ] Commit: `feat: show user, theme and settings changes`

---

## Bloco 4 — Atividade de conteúdo

### Task 12: Últimos conteúdos alterados (TDD)

**Files:** `src/lib/wp-rest.ts`, `src/lib/wp-rest.test.ts`, `src/lib/types.ts`

**Não use `/revisions`**: é uma requisição por post, o que num site com centenas de
posts estoura qualquer orçamento de varredura. Use:

```
/wp/v2/posts?context=edit&orderby=modified&order=desc&per_page=20&_fields=id,title,modified,author,status,link
```

e o mesmo para `pages`. Devolve os 20 mais recentemente alterados com autor (id) e data
— resolve "o que mexeram por último" sem N+1.

Tipo `ContentActivity { id, kind: 'post' | 'page', title, modified, author_id, status, link }`.
`author_id` resolve contra `scan_users` na hora de exibir; se o autor não estiver no
snapshot, mostre o id, **não invente nome**.

Best-effort, dentro do `attempt()` existente.

- [ ] Commit: `feat: read recently modified content`

---

### Task 13: Persistir e exibir

**Files:** `sql/011_content_activity.sql`, `src/lib/db.ts`, `src/components/InventoryTabs.tsx`

Tabela `scan_content` com os mesmos campos, PK `(scan_id, kind, id)`. Aba **Atividade**
listando título, tipo, autor (resolvido) e quando.

Mesma advertência de copy do Task 11: isto mostra **o que mudou**, e o autor é o autor
registrado do conteúdo — não necessariamente quem fez a última alteração.

- [ ] Commit: `feat: show recent content activity`

---

## Bloco 5 — MCP e documentação

### Task 14: Tools novas

**Files:** `src/lib/mcp/queries.ts`, `src/lib/mcp/tools.ts`, `mcp/test/smoke.test.mjs`, `mcp/test/remote.test.mjs`

Três tools, seguindo o padrão das dez existentes (`READ_ONLY`, `siteOrError`, `ownerId`
injetado, SQL fixo):

- `get_site_health` — testes da varredura mais recente. Resumo deve destacar `critical`.
- `list_unhealthy_sites` — **cross-site**: todos os sites da conta com algum `critical`.
  É a pergunta de frota, e é onde o MCP ganha do painel.
- `get_recent_changes` — diffs de usuário/tema/settings da última varredura, com a
  ressalva de que não é auditoria embutida na `description` da tool.

Atualizar a contagem de tools nos dois arquivos de teste (13 no total).

- [ ] Commit: `feat: expose health and changes through MCP`

---

### Task 15: Documentação

**Files:** `README.md`, vault

README: seção de saúde do site, atualização de tema, a ressalva sobre diff ≠ auditoria,
e a lista de tools atualizada. A tabela de erros ganha a nota sobre o diagnóstico de
`authorization-header`.

Vault: sessão, histórico, `features.md`, `arquitetura.md` (rotas e tabelas novas),
`decisoes.md` se alguma escolha desta fase tiver custo de reverter.

- [ ] Commit: `docs: document health, theme updates and change detection`

---

## Self-review do plano

**Cobertura do pedido:** saúde ✔ (bloco 1), atualização de tema ✔ (bloco 2), "logs" ✔
(bloco 3 + 4, com a ressalva explícita de que é diff, não auditoria).

**O que este plano deliberadamente NÃO faz:** dump de banco, dump de tema clássico,
log de evento de usuário, e qualquer coisa que exija instalar código em site de cliente.
Os três primeiros são impossíveis com a arquitetura atual; o quarto é a decisão D-009 e
só muda por ADR novo.

**Riscos conhecidos:**
- `directory-sizes` pode não funcionar; tratado como best-effort e fora do escopo.
- Seis requisições a mais por varredura (Site Health) somadas às de tema no wp.org
  aumentam o tempo de scan. O orçamento de `latestVersions` já existe; medir e, se
  apertar, paralelizar os testes de saúde (já são paralelos) ou reduzir a frequência
  deles para menos que a das varreduras.
