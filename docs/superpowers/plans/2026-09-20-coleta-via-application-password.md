# Coleta via Application Password — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar a fonte de dados do dash-f2f do endpoint customizado `/wp-json/site-status/v1/plugins` para a REST API nativa do WordPress autenticada por Application Password, ampliando o inventário para plugins, temas, usuários e settings.

**Architecture:** Cada site passa a ter uma credencial (usuário WP + Application Password) cifrada em AES-256-GCM no nosso Postgres, com a chave fora do banco. Um cliente REST autenticado (`src/lib/wp-rest.ts`) lê os quatro recursos do core. Como `/wp/v2/plugins` não devolve atualização pendente, `has_update` passa a ser **calculado**: versão instalada vs. versão publicada em `api.wordpress.org`, com cache compartilhado. Plugin fora do repositório oficial fica marcado como cobertura desconhecida, explicitamente, na UI e no MCP.

**Tech Stack:** Next.js 16 (App Router), TypeScript, React 19, Neon Postgres (`@neondatabase/serverless`), `node:crypto`, Vitest (novo), MCP SDK.

---

## Contexto que o implementador precisa ter

Leia antes de começar:

- `README.md` — seção "Garantia de somente leitura". **Ela vai precisar ser reescrita** ao fim deste plano: deixa de ser verdade que o painel não guarda credencial.
- `src/lib/wp.ts` — hoje é o único ponto de saída para o WordPress. Será substituído por `src/lib/wp-rest.ts` e removido na Task 18.
- `src/lib/db.ts` — toda query é escopada por `owner_id`. Mantenha essa disciplina nas novas.
- `scripts/setup-reader-role.mjs` — a role `dash_f2f_reader` do MCP. Ver o alerta de segurança na Task 4.

### Decisões já tomadas (não relitigar durante a execução)

| # | Decisão | Motivo |
|---|---|---|
| D-A | Sem plugin WordPress próprio | Zero instalação no cliente foi requisito explícito |
| D-B | `has_update` calculado contra api.wordpress.org | Consequência de D-A: o core não expõe o transient `update_plugins` por REST |
| D-C | Credencial em AES-256-GCM, chave em env var | Secret manager dedicado é dependência grande demais para o tamanho do projeto |
| D-D | Cobertura parcial é exibida, nunca silenciada | Plugin premium não tem dado no wp.org; esconder isso é mentir no painel |

### Trade-off de segurança que este plano aceita conscientemente

Hoje o dash-f2f não guarda credencial nenhuma. Depois deste plano, guarda credencial com capability `activate_plugins` (admin na prática) de cada site monitorado. **O raio de explosão de um vazamento nosso passa de "inventário exposto" para "backdoor instalável na frota inteira".** As mitigações obrigatórias estão nas Tasks 3, 4 e 5 e não são opcionais.

### Fases

- **Fase 1 (Tasks 1–12):** credenciais + plugins via REST autenticada. **Entregável sozinha** — ao fim dela o painel funciona ponta a ponta no novo caminho.
- **Fase 2 (Tasks 13–16):** temas, usuários e settings.
- **Fase 3 (Tasks 17–18):** MCP e remoção do caminho antigo.

Se preferir plano separado por fase, corte aqui: cada fase produz software funcionando.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade | Ação |
|---|---|---|
| `vitest.config.ts` | runner de testes do `src/` | criar |
| `test/stubs/server-only.ts` | stub para `import 'server-only'` sob teste | criar |
| `src/lib/version.ts` | comparação de versões, puro | criar |
| `src/lib/crypto.ts` | cifra/decifra segredo (AES-256-GCM) | criar |
| `src/lib/wp-rest.ts` | cliente REST autenticado do WordPress | criar |
| `src/lib/wporg.ts` | versão publicada no wordpress.org + cache | criar |
| `src/lib/inventory.ts` | junta REST + wporg no tipo `Plugin` | criar |
| `src/lib/credentials.ts` | persistência da credencial por site | criar |
| `src/components/CredentialForm.tsx` | cadastro da Application Password | criar |
| `src/components/InventoryTabs.tsx` | abas plugins/temas/usuários/settings | criar |
| `sql/004_site_credentials.sql` | tabela de credenciais + revogação | criar |
| `sql/005_wporg_cache.sql` | cache de versões do wp.org | criar |
| `sql/006_scan_update_source.sql` | origem do veredito de atualização | criar |
| `sql/007_inventory.sql` | snapshots de temas/usuários/settings | criar |
| `src/components/States.tsx` | copy de erro das credenciais | modificar |
| `src/lib/types.ts` | novos tipos e novos `ApiErrorKind` | modificar |
| `src/lib/db.ts` | persistência do inventário ampliado | modificar |
| `src/app/api/plugins/route.ts` | usar o novo coletor | modificar |
| `src/app/api/cron/scan/route.ts` | usar o novo coletor | modificar |
| `src/app/actions.ts` | actions de credencial | modificar |
| `scripts/setup-reader-role.mjs` | revogar acesso do MCP às credenciais | modificar |
| `src/lib/wp.ts` | coletor antigo | **remover** (Task 18) |

---

## Fase 1 — Credenciais e coleta autenticada de plugins

### Task 1: Infraestrutura de testes

Hoje não existe runner para o `src/` — só `node:test` sobre o `dist` do MCP. A pendência "lib/plugins.ts, lib/site-url.ts e lib/diff.ts pedem Vitest" já estava aberta; esta task a fecha.

**Files:**
- Create: `vitest.config.ts`
- Create: `test/stubs/server-only.ts`
- Modify: `package.json`

- [ ] **Step 1: Instalar o Vitest**

```bash
npm i -D vitest@^3
```

- [ ] **Step 2: Criar o stub do `server-only`**

O pacote `server-only` lança erro quando importado fora do contexto React Server. Sob Vitest isso derruba qualquer módulo de servidor. O alias abaixo o neutraliza só nos testes.

Create `test/stubs/server-only.ts`:

```ts
// Sob Vitest, `import 'server-only'` precisa ser inofensivo.
// Em produção o pacote real continua valendo e protege o bundle do cliente.
export {};
```

- [ ] **Step 3: Criar a config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      'server-only': resolve(__dirname, 'test/stubs/server-only.ts'),
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Adicionar o script**

Modify `package.json`, no bloco `scripts`, logo abaixo de `"lint"`:

```json
"test": "vitest run",
"test:watch": "vitest",
```

- [ ] **Step 5: Verificar que o runner sobe**

Run: `npm test`
Expected: `No test files found` e exit 0. Se acusar erro de config, corrija antes de seguir.

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts test/stubs/server-only.ts package.json package-lock.json
git commit -m "chore: add vitest for src/ unit tests"
```

---

### Task 2: Comparação de versões

`has_update` deixa de vir pronto do WordPress e passa a ser uma comparação nossa. Essa comparação é o coração da métrica principal do painel — é o primeiro lugar onde um bug silencioso vira número errado na tela.

**Files:**
- Create: `src/lib/version.ts`
- Test: `src/lib/version.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Create `src/lib/version.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { compareVersions, isOutdated } from './version';

describe('compareVersions', () => {
  it('compara segmentos numéricos', () => {
    expect(compareVersions('1.0.0', '1.0.1')).toBe(-1);
    expect(compareVersions('1.0.1', '1.0.0')).toBe(1);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });

  it('não compara como string: 3.21.5 é menor que 3.100.0', () => {
    expect(compareVersions('3.21.5', '3.100.0')).toBe(-1);
  });

  it('trata número diferente de segmentos', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1.2', '1.2.1')).toBe(-1);
  });

  it('pré-lançamento perde da versão final', () => {
    expect(compareVersions('1.0.0-beta1', '1.0.0')).toBe(-1);
    expect(compareVersions('1.0.0', '1.0.0-beta1')).toBe(1);
  });

  it('ignora segmento não numérico no meio sem explodir', () => {
    expect(compareVersions('1.0.x', '1.0.0')).toBe(0);
  });
});

describe('isOutdated', () => {
  it('true quando a instalada é menor que a publicada', () => {
    expect(isOutdated('3.21.5', '3.23.4')).toBe(true);
  });

  it('false quando está em dia ou à frente', () => {
    expect(isOutdated('3.23.4', '3.23.4')).toBe(false);
    expect(isOutdated('4.0.0', '3.23.4')).toBe(false);
  });

  it('false quando não há versão publicada conhecida', () => {
    expect(isOutdated('3.21.5', null)).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/version.test.ts`
Expected: FAIL — `Failed to resolve import "./version"`

- [ ] **Step 3: Implementar**

Create `src/lib/version.ts`:

```ts
// Comparação de versões no estilo WordPress. Puro e testável.
//
// Existe porque /wp/v2/plugins devolve a versão instalada mas NÃO devolve se há
// atualização — esse dado mora no transient `update_plugins`, que o core não
// expõe por REST. Comparamos contra a versão publicada no wordpress.org.

/** Divide "1.2.3-beta1" em [1, 2, 3] + flag de pré-lançamento. */
function parse(version: string): { parts: number[]; pre: boolean } {
  const raw = String(version ?? '').trim();
  const pre = /-(?:alpha|beta|rc|dev)/i.test(raw);
  const parts = raw
    .split('-')[0]
    .split('.')
    .map((segment) => {
      const n = Number.parseInt(segment, 10);
      return Number.isNaN(n) ? 0 : n;
    });
  return { parts, pre };
}

/** -1 se a < b, 0 se iguais, 1 se a > b. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.parts.length, right.parts.length);

  for (let i = 0; i < length; i += 1) {
    const x = left.parts[i] ?? 0;
    const y = right.parts[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }

  // Mesmos números: pré-lançamento perde da versão final.
  if (left.pre && !right.pre) return -1;
  if (!left.pre && right.pre) return 1;
  return 0;
}

/**
 * @param installed versão lida do site
 * @param latest versão publicada no wordpress.org; `null` quando o plugin não
 *   está no repositório oficial — nesse caso NÃO afirmamos nada.
 */
export function isOutdated(installed: string, latest: string | null): boolean {
  if (!latest) return false;
  return compareVersions(installed, latest) === -1;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/version.test.ts`
Expected: PASS — 8 testes.

- [ ] **Step 5: Commit**

```bash
git add src/lib/version.ts src/lib/version.test.ts
git commit -m "feat: add version comparison for computed update detection"
```

---

### Task 3: Cifra da credencial

**Files:**
- Create: `src/lib/crypto.ts`
- Test: `src/lib/crypto.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Create `src/lib/crypto.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { CredentialsKeyError, decryptSecret, encryptSecret } from './crypto';

beforeEach(() => {
  process.env.CREDENTIALS_KEY = randomBytes(32).toString('base64');
});

describe('encryptSecret / decryptSecret', () => {
  it('faz a volta completa', () => {
    const secret = 'abcd EFGH ijkl MNOP qrst UVWX';
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it('nunca repete o ciphertext para o mesmo texto (IV aleatório)', () => {
    expect(encryptSecret('mesmo')).not.toBe(encryptSecret('mesmo'));
  });

  it('não deixa o segredo aparecer em claro no payload', () => {
    expect(encryptSecret('senha-secreta')).not.toContain('senha-secreta');
  });

  it('rejeita payload adulterado (tag GCM)', () => {
    const payload = encryptSecret('original');
    const [v, iv, tag, data] = payload.split('.');
    const mexido = [v, iv, tag, Buffer.from('outra-coisa').toString('base64url')].join('.');
    expect(() => decryptSecret(mexido)).toThrow();
  });

  it('exige chave de 32 bytes', () => {
    process.env.CREDENTIALS_KEY = Buffer.from('curta').toString('base64');
    expect(() => encryptSecret('x')).toThrow(CredentialsKeyError);
  });

  it('falha claro quando a chave não existe', () => {
    delete process.env.CREDENTIALS_KEY;
    expect(() => encryptSecret('x')).toThrow(CredentialsKeyError);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/crypto.test.ts`
Expected: FAIL — `Failed to resolve import "./crypto"`

- [ ] **Step 3: Implementar**

Create `src/lib/crypto.ts`:

```ts
import 'server-only';

// Cifra dos segredos guardados no Postgres (hoje: Application Password de cada
// site). AES-256-GCM: confidencialidade + autenticação, então payload adulterado
// falha em vez de decifrar lixo.
//
// A chave vive em CREDENTIALS_KEY, FORA do banco. Um dump do Postgres sozinho
// não abre nenhuma credencial — é essa separação que faz o desenho valer.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

export class CredentialsKeyError extends Error {}

function key(): Buffer {
  const raw = process.env.CREDENTIALS_KEY;
  if (!raw) {
    throw new CredentialsKeyError(
      'CREDENTIALS_KEY ausente. Gere com: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== KEY_BYTES) {
    throw new CredentialsKeyError(`CREDENTIALS_KEY deve ter ${KEY_BYTES} bytes em base64 (tem ${buf.length}).`);
  }
  return buf;
}

/** Formato: `v1.<iv>.<tag>.<ciphertext>`, cada parte em base64url. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}

export function decryptSecret(payload: string): string {
  const [version, iv, tag, data] = String(payload ?? '').split('.');
  if (version !== 'v1' || !iv || !tag || !data) {
    throw new CredentialsKeyError('Payload cifrado em formato inesperado.');
  }
  const decipher = createDecipheriv(ALGO, key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(data, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/crypto.test.ts`
Expected: PASS — 6 testes.

- [ ] **Step 5: Gerar a chave local**

```bash
node -e "console.log('CREDENTIALS_KEY=' + require('crypto').randomBytes(32).toString('base64'))" >> .env.local
```

Confira que a linha entrou em `.env.local` e que `.env.local` continua no `.gitignore`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/crypto.ts src/lib/crypto.test.ts
git commit -m "feat: add AES-256-GCM secret encryption for site credentials"
```

---

### Task 4: Tabela de credenciais — e o furo do reader role

> **ALERTA DE SEGURANÇA.** `scripts/setup-reader-role.mjs:46` roda
> `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO dash_f2f_reader`.
> **Toda tabela nova nasce legível pela role do MCP.** Sem a revogação explícita
> abaixo, o conector MCP remoto — que é exposto publicamente em `/api/mcp` com
> token — passa a ler as credenciais de todos os sites de todos os clientes.
> Esta task e a Task 5 fecham isso. Não pule nenhuma das duas.

**Files:**
- Create: `sql/004_site_credentials.sql`

- [ ] **Step 1: Escrever a migration**

Create `sql/004_site_credentials.sql`:

```sql
-- Credencial de leitura de cada site: usuário WP + Application Password.
-- A senha NUNCA é gravada em claro — só o payload AES-256-GCM de src/lib/crypto.ts,
-- cuja chave (CREDENTIALS_KEY) vive fora do banco.
--
-- Um site tem no máximo uma credencial: site_id é a PK.

CREATE TABLE IF NOT EXISTS site_credentials (
  site_id           uuid PRIMARY KEY REFERENCES sites (id) ON DELETE CASCADE,
  wp_user           text NOT NULL,
  password_cipher   text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  last_verified_at  timestamptz,
  last_error        text
);

-- CRÍTICO: a role do MCP (dash_f2f_reader) recebe SELECT automático em toda
-- tabela nova por causa do ALTER DEFAULT PRIVILEGES em setup-reader-role.mjs.
-- O MCP é exposto publicamente em /api/mcp: ele não pode, em hipótese alguma,
-- ler esta tabela. A revogação abaixo é a segunda barreira (a primeira é o
-- REVOKE explícito no próprio script).
-- ATENÇÃO ao formato: scripts/migrate.mjs quebra o arquivo em statements com
-- `.split(/;\s*$/m)` — semicolon em fim de linha. Um bloco DO $$ ... $$ escrito
-- em várias linhas seria rasgado ao meio, porque os `;` internos caem em fim de
-- linha. Mantido em UMA linha de propósito: assim só o `$$;` final casa com o
-- separador. Não reformate isso para "ficar legível".
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dash_f2f_reader') THEN REVOKE ALL ON TABLE site_credentials FROM dash_f2f_reader; END IF; END $$;
```

- [ ] **Step 2: Aplicar**

Run: `npm run db:migrate`
Expected: `✓ 004_site_credentials.sql (2 statements)`

- [ ] **Step 3: Provar que o reader não enxerga a tabela**

```bash
node --env-file=.env.local -e "
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL_MCP);
sql\`SELECT count(*) FROM site_credentials\`
  .then(() => { console.error('FALHOU: o reader conseguiu ler site_credentials'); process.exit(1); })
  .catch((e) => { console.log('OK, negado:', e.message); process.exit(0); });
"
```

Expected: `OK, negado: permission denied for table site_credentials`
Se imprimir `FALHOU`, **pare** e conserte antes de seguir.

- [ ] **Step 4: Commit**

```bash
git add sql/004_site_credentials.sql
git commit -m "feat: add site_credentials table, revoked from MCP reader role"
```

---

### Task 5: Blindar o script da role de leitura

A revogação da Task 4 roda uma vez. O script da role roda de novo a cada máquina nova e **reaplica o default privilege**. Precisa revogar sempre.

**Files:**
- Modify: `scripts/setup-reader-role.mjs:19` e `:48`

- [ ] **Step 1: Declarar as tabelas proibidas**

Modify `scripts/setup-reader-role.mjs`, logo abaixo da linha `const READ_TABLES = [...]`:

```js
// Tabelas que o MCP NUNCA pode ler. O ALTER DEFAULT PRIVILEGES abaixo concede
// SELECT em toda tabela nova; estas precisam de revogação explícita, sempre.
const FORBIDDEN_TABLES = ['site_credentials', 'api_tokens'];
```

- [ ] **Step 2: Revogar depois dos grants**

Modify `scripts/setup-reader-role.mjs`, logo após o bloco que faz `REVOKE INSERT, UPDATE, DELETE, TRUNCATE`:

```js
// Revogação total nas tabelas de segredo — inclusive o SELECT herdado do
// ALTER DEFAULT PRIVILEGES. Tolerante a tabela ainda não criada.
for (const table of FORBIDDEN_TABLES) {
  try {
    await sql.query(`REVOKE ALL ON TABLE ${table} FROM ${ROLE}`);
    console.log(`· ${table}: acesso revogado do ${ROLE}`);
  } catch (err) {
    if (!/does not exist/i.test(err.message)) throw err;
  }
}
```

- [ ] **Step 3: Rodar e verificar**

Run: `npm run db:reader`
Expected: entre as linhas, `· site_credentials: acesso revogado do dash_f2f_reader` e `· api_tokens: acesso revogado do dash_f2f_reader`

- [ ] **Step 4: Repetir a prova da Task 4 Step 3**

Expected: `OK, negado: permission denied for table site_credentials`

- [ ] **Step 5: Commit**

```bash
git add scripts/setup-reader-role.mjs
git commit -m "fix: always revoke MCP reader access to secret tables"
```

---

### Task 6: Persistência da credencial

**Files:**
- Create: `src/lib/credentials.ts`

- [ ] **Step 1: Implementar**

Create `src/lib/credentials.ts`:

```ts
import 'server-only';

// Credencial de leitura por site. A senha entra em claro aqui e sai cifrada
// para o banco; o caminho inverso só acontece no momento da varredura.
//
// Toda função exige ownerId: a posse do site é verificada no SQL, nunca antes.

import { neon } from '@neondatabase/serverless';
import { decryptSecret, encryptSecret } from './crypto';

const sql = neon(process.env.DATABASE_URL!);

export type CredentialStatus = {
  wp_user: string;
  created_at: string;
  last_verified_at: string | null;
  last_error: string | null;
};

/** Grava ou substitui a credencial. A senha em claro não sobrevive a esta função. */
export async function saveCredential(
  ownerId: string,
  siteId: string,
  wpUser: string,
  appPassword: string,
): Promise<void> {
  const cipher = encryptSecret(appPassword);
  const rows = (await sql`
    INSERT INTO site_credentials (site_id, wp_user, password_cipher)
    SELECT ${siteId}, ${wpUser}, ${cipher}
      FROM sites WHERE id = ${siteId} AND owner_id = ${ownerId}
    ON CONFLICT (site_id) DO UPDATE
       SET wp_user = EXCLUDED.wp_user,
           password_cipher = EXCLUDED.password_cipher,
           updated_at = now(),
           last_error = NULL
    RETURNING site_id
  `) as Array<{ site_id: string }>;

  if (rows.length === 0) throw new Error('Site não encontrado nesta conta.');
}

/** Credencial decifrada, para uso imediato na varredura. Null quando não há. */
export async function getCredential(
  siteId: string,
): Promise<{ user: string; password: string } | null> {
  const rows = (await sql`
    SELECT wp_user, password_cipher FROM site_credentials WHERE site_id = ${siteId}
  `) as Array<{ wp_user: string; password_cipher: string }>;

  if (rows.length === 0) return null;
  return { user: rows[0].wp_user, password: decryptSecret(rows[0].password_cipher) };
}

/** Status para a UI — nunca devolve a senha, nem cifrada. */
export async function credentialStatus(
  ownerId: string,
  siteId: string,
): Promise<CredentialStatus | null> {
  const rows = (await sql`
    SELECT c.wp_user, c.created_at, c.last_verified_at, c.last_error
      FROM site_credentials c
      JOIN sites s ON s.id = c.site_id
     WHERE c.site_id = ${siteId} AND s.owner_id = ${ownerId}
  `) as CredentialStatus[];
  return rows[0] ?? null;
}

export async function deleteCredential(ownerId: string, siteId: string): Promise<void> {
  await sql`
    DELETE FROM site_credentials
     WHERE site_id = ${siteId}
       AND site_id IN (SELECT id FROM sites WHERE owner_id = ${ownerId})
  `;
}

/** Registra o resultado da última tentativa de uso. */
export async function markCredentialResult(siteId: string, error: string | null): Promise<void> {
  await sql`
    UPDATE site_credentials
       SET last_error = ${error},
           last_verified_at = CASE WHEN ${error}::text IS NULL THEN now() ELSE last_verified_at END
     WHERE site_id = ${siteId}
  `;
}
```

- [ ] **Step 2: Verificar que compila**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sem erros em `src/lib/credentials.ts`

- [ ] **Step 3: Commit**

```bash
git add src/lib/credentials.ts
git commit -m "feat: add per-site credential persistence"
```

---

### Task 7: Cliente REST autenticado

**Files:**
- Create: `src/lib/wp-rest.ts`
- Test: `src/lib/wp-rest.test.ts`
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Estender os tipos de erro**

Modify `src/lib/types.ts`, no `ApiErrorKind`:

```ts
export type ApiErrorKind =
  | 'invalid_url'
  | 'not_found'
  | 'http'
  | 'network'
  | 'bad_payload'
  | 'no_credential'   // site sem Application Password cadastrada
  | 'bad_credential'  // credencial gravada não decifra: pedir novo cadastro
  | 'unauthorized'    // 401: credencial errada ou revogada no WP
  | 'forbidden';      // 403: usuário sem capability (ex.: activate_plugins)
```

Ainda em `src/lib/types.ts`, adicione os tipos do inventário, logo abaixo de `Plugin`:

```ts
/**
 * De onde saiu o veredito de atualização pendente. Procedência, não qualidade.
 *  - 'wporg'   — comparamos a versão instalada com a publicada no wordpress.org
 *  - 'site'    — o próprio site afirmou, via o endpoint customizado antigo, que
 *                lia o transient `update_plugins`. Só existe em histórico
 *                anterior à migração; nenhum código novo produz este valor.
 *  - 'unknown' — não dá para afirmar nada (plugin fora do repositório oficial,
 *                ou versão instalada ilegível).
 */
export type UpdateSource = 'wporg' | 'site' | 'unknown';

/** Plugin como sai do /wp/v2/plugins, antes de cruzar com o wordpress.org. */
export type RawPlugin = {
  file: string;
  name: string;
  /** `null` quando o site não informou versão. NÃO use '—' aqui: '—' é
   *  placeholder de exibição, e tratá-lo como dado faz `parse()` lê-lo como
   *  versão 0, o que transformaria "não sei" em "desatualizado". */
  version: string | null;
  is_active: boolean;
  slug: string;
};
```

Acrescentar `update_source` a `Plugin` quebra o único lugar que ainda constrói um
literal desse tipo: `normalizePlugin` em `src/lib/wp.ts:87`, o coletor antigo.
Ele só sai de cena na Task 18, então mantenha a árvore compilando com uma ponte
de uma linha — modifique `src/lib/wp.ts`, no `return` de `normalizePlugin`:

```ts
    new_version: p.new_version != null ? String(p.new_version) : '',
    // Transitório: o coletor antigo lê has_update do endpoint customizado, que
    // por sua vez lê o transient `update_plugins`. A procedência é o próprio
    // site — não o wordpress.org. Este arquivo inteiro sai na Task 18.
    update_source: 'site' as const,
```

Todos os outros usos de `Plugin` são casts (`as Plugin[]`) ou tipos de parâmetro
— nenhum quebra.

E acrescente o campo em `Plugin`:

```ts
export type Plugin = {
  file: string;
  name: string;
  version: string;
  is_active: boolean;
  has_update: boolean;
  new_version: string;
  /** 'unknown' = plugin fora do repositório oficial; has_update não é confiável. */
  update_source: UpdateSource;
};
```

- [ ] **Step 2: Escrever o teste que falha**

Create `src/lib/wp-rest.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WpError, fetchRawPlugins } from './wp-rest';

const CRED = { user: 'admin', password: 'abcd EFGH ijkl MNOP qrst UVWX' };

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue(
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchRawPlugins', () => {
  it('manda Basic auth e normaliza o slug a partir do campo plugin', async () => {
    const fetchMock = mockFetch(200, [
      { plugin: 'elementor/elementor', status: 'active', name: 'Elementor', version: '3.21.5' },
      { plugin: 'hello', status: 'inactive', name: 'Hello Dolly', version: '1.7.2' },
    ]);
    vi.stubGlobal('fetch', fetchMock);

    const plugins = await fetchRawPlugins('https://exemplo.com', CRED);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://exemplo.com/wp-json/wp/v2/plugins');
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe(
      'Basic ' + Buffer.from(`${CRED.user}:${CRED.password}`).toString('base64'),
    );

    expect(plugins).toEqual([
      { file: 'elementor/elementor', name: 'Elementor', version: '3.21.5', is_active: true, slug: 'elementor' },
      { file: 'hello', name: 'Hello Dolly', version: '1.7.2', is_active: false, slug: 'hello' },
    ]);
  });

  it('versão ausente ou vazia vira null, nunca o placeholder de exibição', async () => {
    vi.stubGlobal('fetch', mockFetch(200, [
      { plugin: 'sem-versao/sem-versao', status: 'active', name: 'Sem Versão' },
      { plugin: 'vazia/vazia', status: 'active', name: 'Vazia', version: '' },
    ]));

    const plugins = await fetchRawPlugins('https://exemplo.com', CRED);
    expect(plugins.map((p) => p.version)).toEqual([null, null]);
  });

  it('401 vira unauthorized', async () => {
    vi.stubGlobal('fetch', mockFetch(401, { code: 'incorrect_password' }));
    await expect(fetchRawPlugins('https://exemplo.com', CRED)).rejects.toMatchObject({ kind: 'unauthorized' });
  });

  it('403 vira forbidden', async () => {
    vi.stubGlobal('fetch', mockFetch(403, { code: 'rest_cannot_view_plugins' }));
    await expect(fetchRawPlugins('https://exemplo.com', CRED)).rejects.toMatchObject({ kind: 'forbidden' });
  });

  it('404 vira not_found', async () => {
    vi.stubGlobal('fetch', mockFetch(404, { code: 'rest_no_route' }));
    await expect(fetchRawPlugins('https://exemplo.com', CRED)).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('resposta que não é array vira bad_payload', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { nope: true }));
    await expect(fetchRawPlugins('https://exemplo.com', CRED)).rejects.toMatchObject({ kind: 'bad_payload' });
  });

  it('host interno é bloqueado antes de qualquer requisição', async () => {
    const fetchMock = mockFetch(200, []);
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchRawPlugins('http://192.168.0.10', CRED)).rejects.toMatchObject({ kind: 'invalid_url' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('erro nunca vaza a senha na mensagem', async () => {
    vi.stubGlobal('fetch', mockFetch(401, { code: 'incorrect_password' }));
    await expect(fetchRawPlugins('https://exemplo.com', CRED)).rejects.toSatisfy(
      (e: Error) => !e.message.includes(CRED.password),
    );
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run src/lib/wp-rest.test.ts`
Expected: FAIL — `Failed to resolve import "./wp-rest"`

- [ ] **Step 4: Implementar**

Create `src/lib/wp-rest.ts`:

```ts
import 'server-only';

// Cliente da REST API nativa do WordPress, autenticado por Application Password.
// Substitui src/lib/wp.ts: em vez de um endpoint customizado público, fala com
// /wp-json/wp/v2/* usando Basic auth.
//
// CONTRATO: só GET sai daqui. A credencial tem poder de escrita no WordPress
// (Application Password herda TODAS as capabilities do usuário — o core não tem
// escopo granular), então a disciplina de só-GET deixou de ser garantida pela
// credencial e passou a ser garantida por este módulo. Não adicione outro método.

import { isPrivateHost } from './site-url';
import type { ApiErrorKind, RawPlugin } from './types';

const TIMEOUT_MS = 12_000;

export type Credential = { user: string; password: string };

export class WpError extends Error {
  kind: ApiErrorKind;
  status: number;
  detail?: string;
  constructor(kind: ApiErrorKind, status: number, message: string, detail?: string) {
    super(message);
    this.name = 'WpError';
    this.kind = kind;
    this.status = status;
    this.detail = detail;
  }
}

function authHeader({ user, password }: Credential): string {
  return 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');
}

/**
 * GET autenticado num caminho da REST API. Devolve o JSON já parseado.
 * Nenhuma mensagem de erro daqui inclui a credencial.
 */
export async function wpGet(site: string, path: string, credential: Credential): Promise<unknown> {
  if (process.env.ALLOW_PRIVATE_HOSTS !== '1' && isPrivateHost(new URL(site).hostname)) {
    throw new WpError('invalid_url', 400, 'Endereços locais ou de rede interna não são permitidos.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let upstream: Response;
  try {
    upstream = await fetch(`${site}${path}`, {
      method: 'GET', // read-only, sempre
      headers: {
        Accept: 'application/json',
        Authorization: authHeader(credential),
        'User-Agent': 'dash-f2f/2.0 (read-only inventory)',
      },
      redirect: 'follow',
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    throw new WpError(
      'network',
      504,
      aborted ? 'O site não respondeu a tempo.' : 'Falha de rede ao contatar o site.',
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    clearTimeout(timer);
  }

  if (upstream.status === 401) {
    throw new WpError(
      'unauthorized',
      401,
      'Credencial recusada. A Application Password pode ter sido revogada no WordPress, ou o servidor está descartando o cabeçalho Authorization.',
    );
  }
  if (upstream.status === 403) {
    throw new WpError(
      'forbidden',
      403,
      'O usuário não tem permissão para este recurso. Ler plugins exige a capability activate_plugins (administrador).',
    );
  }
  if (upstream.status === 404) {
    throw new WpError('not_found', 404, `Rota ${path} não encontrada. A REST API pode estar desabilitada neste site.`);
  }
  if (!upstream.ok) {
    throw new WpError('http', 502, `O site respondeu ${upstream.status} ${upstream.statusText}.`);
  }

  try {
    return await upstream.json();
  } catch {
    throw new WpError('bad_payload', 502, 'A resposta do site não é JSON válido.');
  }
}

/** Inventário cru de plugins. `has_update` NÃO vem daqui — ver src/lib/inventory.ts. */
export async function fetchRawPlugins(site: string, credential: Credential): Promise<RawPlugin[]> {
  const data = await wpGet(site, '/wp-json/wp/v2/plugins', credential);
  if (!Array.isArray(data)) {
    throw new WpError('bad_payload', 502, 'A resposta de /wp/v2/plugins não é uma lista.');
  }
  return data.map(normalizeRawPlugin);
}

function normalizeRawPlugin(raw: unknown): RawPlugin {
  const p = (raw ?? {}) as Record<string, unknown>;
  const file = typeof p.plugin === 'string' ? p.plugin : '';
  return {
    file,
    name: typeof p.name === 'string' && p.name ? p.name : file || 'Plugin sem nome',
    // Versão ausente vira null, nunca '—'. O placeholder só aparece na hora de
    // renderizar (ver mergePluginVersions); como dado, ele seria lido como
    // versão 0 e faria um plugin de versão desconhecida contar como pendente.
    version: p.version != null && String(p.version).trim() ? String(p.version) : null,
    is_active: p.status === 'active',
    slug: wporgSlug(file, p.plugin_uri),
  };
}

/**
 * Slug com que o wordpress.org conhece o plugin.
 *
 * O caminho do arquivo quase sempre serve ("elementor/elementor" -> "elementor"),
 * mas não sempre: o Hello Dolly é `hello.php` na raiz, o que daria "hello" — e
 * no repositório ele é "hello-dolly". Resultado: um plugin que ESTÁ no
 * repositório apareceria como "atualização desconhecida".
 *
 * Quando o `plugin_uri` aponta para wordpress.org/plugins/<slug>, esse slug é
 * declarado pelo próprio plugin e vale mais que o nome da pasta. Só aí ele
 * ganha; no resto dos casos a pasta continua mandando.
 *
 * Achado rodando contra um WordPress real — os testes com fetch stubado não
 * pegavam, porque afirmavam que "hello" vira slug "hello", o que é verdade e
 * ainda assim é o slug errado.
 */
export function wporgSlug(file: string, pluginUri: unknown): string {
  const fromDir = file.split('/')[0];
  if (typeof pluginUri !== 'string') return fromDir;
  const match = pluginUri.match(/wordpress\.org\/plugins\/([^/?#]+)/i);
  return match ? match[1] : fromDir;
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run src/lib/wp-rest.test.ts`
Expected: PASS — 7 testes.

- [ ] **Step 6: Commit**

```bash
git add src/lib/wp-rest.ts src/lib/wp-rest.test.ts src/lib/types.ts
git commit -m "feat: add authenticated WordPress REST client"
```

---

### Task 8: Versões do wordpress.org com cache

Um site com 40 plugins geraria 40 requisições ao wp.org por varredura. O cache é tabela compartilhada entre todos os donos — é dado público, não há vazamento entre contas.

**Files:**
- Create: `sql/005_wporg_cache.sql`
- Create: `src/lib/wporg.ts`
- Test: `src/lib/wporg.test.ts`

- [ ] **Step 1: Migration**

Create `sql/005_wporg_cache.sql`:

```sql
-- Cache das versões publicadas no repositório oficial do WordPress.
-- Dado público e igual para todo mundo: compartilhado entre contas de propósito.
-- latest_version NULL = plugin não existe no repositório (premium ou customizado).

CREATE TABLE IF NOT EXISTS wporg_versions (
  slug            text PRIMARY KEY,
  latest_version  text,
  checked_at      timestamptz NOT NULL DEFAULT now()
);
```

- [ ] **Step 2: Aplicar**

Run: `npm run db:migrate`
Expected: `✓ 005_wporg_cache.sql (1 statements)`

- [ ] **Step 3: Escrever o teste que falha**

Create `src/lib/wporg.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchFromWporg, parseWporgResponse } from './wporg';

afterEach(() => vi.unstubAllGlobals());

describe('parseWporgResponse', () => {
  it('extrai a versão publicada', () => {
    expect(parseWporgResponse({ name: 'Elementor', version: '3.23.4' })).toBe('3.23.4');
  });

  it('plugin inexistente vira null', () => {
    expect(parseWporgResponse({ error: 'Plugin not found.' })).toBeNull();
  });

  it('resposta false vira null', () => {
    expect(parseWporgResponse(false)).toBeNull();
  });

  it('resposta sem version vira null', () => {
    expect(parseWporgResponse({ name: 'Sem versão' })).toBeNull();
  });
});

describe('fetchFromWporg', () => {
  afterEach(() => vi.unstubAllGlobals());

  const ok = (body: unknown, status = 200) =>
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
    );

  it('404 é fato: o plugin não está no repositório', async () => {
    vi.stubGlobal('fetch', ok({ error: 'Plugin not found.' }, 404));
    expect(await fetchFromWporg('acf-pro')).toEqual({ known: true, version: null });
  });

  it('200 com versão é fato', async () => {
    vi.stubGlobal('fetch', ok({ version: '3.23.4' }));
    expect(await fetchFromWporg('elementor')).toEqual({ known: true, version: '3.23.4' });
  });

  it('500 NÃO é fato — não sabemos, e isso não pode virar cache', async () => {
    vi.stubGlobal('fetch', ok({}, 500));
    expect(await fetchFromWporg('elementor')).toEqual({ known: false });
  });

  it('falha de rede NÃO é fato', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    expect(await fetchFromWporg('elementor')).toEqual({ known: false });
  });
});
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `npx vitest run src/lib/wporg.test.ts`
Expected: FAIL — `Failed to resolve import "./wporg"`

- [ ] **Step 5: Implementar**

Create `src/lib/wporg.ts`:

```ts
import 'server-only';

// Versão publicada de cada plugin no repositório oficial.
//
// Existe porque /wp/v2/plugins não devolve atualização pendente. Cruzamos a
// versão instalada com a daqui para calcular has_update.
//
// LIMITE CONHECIDO: só cobre plugin do repositório oficial. Elementor Pro,
// ACF Pro e plugin customizado de agência devolvem null — e null NUNCA vira
// "está em dia", vira update_source: 'unknown' na UI.

import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);
const ENDPOINT = 'https://api.wordpress.org/plugins/info/1.0/';
const TTL_HOURS = 12;
const TIMEOUT_MS = 8_000;
/** Teto de tempo gasto consultando o wp.org por varredura. Ver o laço abaixo. */
const BUDGET_MS = 60_000;

/** Exportada para teste: a forma da resposta do wp.org é instável. */
export function parseWporgResponse(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const body = data as Record<string, unknown>;
  if (body.error) return null;
  return typeof body.version === 'string' ? body.version : null;
}

/**
 * Duas ausências que NÃO podem ser confundidas:
 *  - `{ known: true, version: null }` — o wp.org respondeu e disse que o plugin
 *    não existe no repositório. É fato, e pode ser cacheado.
 *  - `{ known: false }` — a consulta falhou (rede, timeout, 500). Não sabemos
 *    nada, e gravar isso como null no cache faria um plugin comum aparecer
 *    como "atualização desconhecida" por 12 horas por causa de um soluço de
 *    rede. Não cacheia.
 */
type Lookup = { known: true; version: string | null } | { known: false };

/** Exportada para teste: a distinção known/unknown é o que protege o cache. */
export async function fetchFromWporg(slug: string): Promise<Lookup> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${ENDPOINT}${encodeURIComponent(slug)}.json`, {
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': 'dash-f2f/2.0' },
      cache: 'no-store',
      signal: controller.signal,
    });
    // 404 é resposta legítima: o plugin não está no repositório.
    if (response.status === 404) return { known: true, version: null };
    if (!response.ok) return { known: false };
    return { known: true, version: parseWporgResponse(await response.json()) };
  } catch {
    // Rede ou timeout: indisponibilidade nossa, não ausência do plugin.
    return { known: false };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Versão publicada de cada slug. Lê do cache, busca só o que venceu.
 * @returns mapa slug -> versão publicada (ou null quando não há dado)
 */
export async function latestVersions(slugs: string[]): Promise<Map<string, string | null>> {
  const unique = [...new Set(slugs.filter(Boolean))];
  const result = new Map<string, string | null>();
  if (unique.length === 0) return result;

  const cached = (await sql`
    SELECT slug, latest_version, checked_at
      FROM wporg_versions
     WHERE slug = ANY(${unique}::text[])
       AND checked_at > now() - ${`${TTL_HOURS} hours`}::interval
  `) as Array<{ slug: string; latest_version: string | null }>;

  for (const row of cached) result.set(row.slug, row.latest_version);

  const missing = unique.filter((slug) => !result.has(slug));
  if (missing.length === 0) return result;

  // Sequencial de propósito: o wp.org não gosta de rajada, e isso roda no cron.
  // O orçamento existe porque um site com 60 plugins, todos frios e todos
  // lentos, passaria do maxDuration de 300s da rota de cron. Estourado o tempo,
  // o resto fica sem dado NESTA rodada e tenta de novo na próxima — que é
  // diferente de gravar "não existe no repositório".
  const deadline = Date.now() + BUDGET_MS;

  for (const slug of missing) {
    if (Date.now() > deadline) {
      result.set(slug, null);
      continue;
    }

    const lookup = await fetchFromWporg(slug);
    result.set(slug, lookup.known ? lookup.version : null);

    // Só grava o que o wp.org afirmou. Falha de consulta não vira cache:
    // caso contrário um timeout de um segundo faria o plugin aparecer como
    // "atualização desconhecida" pelas próximas 12 horas.
    if (lookup.known) {
      await sql`
        INSERT INTO wporg_versions (slug, latest_version, checked_at)
        VALUES (${slug}, ${lookup.version}, now())
        ON CONFLICT (slug) DO UPDATE
           SET latest_version = EXCLUDED.latest_version, checked_at = now()
      `;
    }
  }

  return result;
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `npx vitest run src/lib/wporg.test.ts`
Expected: PASS — 4 testes.

- [ ] **Step 7: Commit**

```bash
git add sql/005_wporg_cache.sql src/lib/wporg.ts src/lib/wporg.test.ts
git commit -m "feat: add wordpress.org version lookup with cache"
```

---

### Task 9: Montagem do inventário

**Files:**
- Create: `src/lib/inventory.ts`
- Test: `src/lib/inventory.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Create `src/lib/inventory.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mergePluginVersions } from './inventory';
import type { RawPlugin } from './types';

const raw: RawPlugin[] = [
  { file: 'elementor/elementor', name: 'Elementor', version: '3.21.5', is_active: true, slug: 'elementor' },
  { file: 'akismet/akismet', name: 'Akismet', version: '5.3.1', is_active: false, slug: 'akismet' },
  { file: 'acf-pro/acf-pro', name: 'ACF Pro', version: '6.2.0', is_active: true, slug: 'acf-pro' },
  { file: 'sem-versao/sem-versao', name: 'Sem Versão', version: null, is_active: true, slug: 'sem-versao' },
];

describe('mergePluginVersions', () => {
  it('marca desatualizado quando o wp.org tem versão maior', () => {
    const [elementor] = mergePluginVersions(raw, new Map([['elementor', '3.23.4']]));
    expect(elementor).toMatchObject({
      name: 'Elementor',
      has_update: true,
      new_version: '3.23.4',
      update_source: 'wporg',
    });
  });

  it('em dia quando as versões batem', () => {
    const merged = mergePluginVersions(raw, new Map([['akismet', '5.3.1']]));
    expect(merged.find((p) => p.name === 'Akismet')).toMatchObject({
      has_update: false,
      new_version: '',
      update_source: 'wporg',
    });
  });

  it('plugin fora do repositório fica unknown e NUNCA vira desatualizado', () => {
    const merged = mergePluginVersions(raw, new Map([['acf-pro', null]]));
    expect(merged.find((p) => p.name === 'ACF Pro')).toMatchObject({
      has_update: false,
      new_version: '',
      update_source: 'unknown',
    });
  });

  it('slug ausente do mapa também é unknown', () => {
    const merged = mergePluginVersions(raw, new Map());
    expect(merged.every((p) => p.update_source === 'unknown')).toBe(true);
  });

  it('versão instalada desconhecida NUNCA vira desatualizado', () => {
    // Regressão: versão ilegível fazia parse() ler 0, e 0 < 6 marcava pendência
    // em plugin cuja versão o site nem informou. Ver isComparableVersion.
    const merged = mergePluginVersions(raw, new Map([['sem-versao', '6.0.0']]));
    expect(merged.find((p) => p.name === 'Sem Versão')).toMatchObject({
      version: '—',
      has_update: false,
      new_version: '',
      update_source: 'unknown',
    });
  });

  it('preserva file, nome, versão e estado ativo', () => {
    const [elementor] = mergePluginVersions(raw, new Map([['elementor', '3.23.4']]));
    expect(elementor.file).toBe('elementor/elementor');
    expect(elementor.version).toBe('3.21.5');
    expect(elementor.is_active).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/inventory.test.ts`
Expected: FAIL — `Failed to resolve import "./inventory"`

- [ ] **Step 3: Implementar**

Create `src/lib/inventory.ts`:

```ts
// Junta o inventário cru do WordPress com as versões do wordpress.org.
// Puro: recebe as duas listas e devolve o tipo Plugin que a UI já consome.

import { isComparableVersion, isOutdated } from './version';
import type { Plugin, RawPlugin } from './types';

/**
 * @param raw saída de fetchRawPlugins
 * @param latest mapa slug -> versão publicada (null = fora do repositório)
 */
export function mergePluginVersions(
  raw: RawPlugin[],
  latest: Map<string, string | null>,
): Plugin[] {
  return raw.map((plugin) => {
    const installed = plugin.version;
    const published = latest.get(plugin.slug) ?? null;

    // Duas incertezas diferentes, mesmo veredito: versão instalada ilegível (o
    // site não informou, ou informou lixo) ou versão publicada ausente (plugin
    // fora do repositório oficial). Em nenhum dos dois casos dá para afirmar
    // nada — 'unknown' é honesto, 'em dia' seria mentira, e 'desatualizado'
    // seria pior ainda. `isComparableVersion` é o que separa "não sei" de zero.
    const comparable = isComparableVersion(installed) && published !== null;
    // isOutdated já recusa sozinho versão ilegível e publicada ausente, então
    // não precisa de guarda aqui nem de asserção de não-nulo.
    const outdated = isOutdated(installed ?? '', published);

    return {
      file: plugin.file,
      name: plugin.name,
      // O placeholder de exibição entra só aqui, na fronteira de renderização.
      version: installed ?? '—',
      is_active: plugin.is_active,
      has_update: outdated,
      new_version: outdated && published ? published : '',
      update_source: comparable ? 'wporg' : 'unknown',
    };
  });
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/inventory.test.ts`
Expected: PASS — 5 testes.

- [ ] **Step 5: Commit**

```bash
git add src/lib/inventory.ts src/lib/inventory.test.ts
git commit -m "feat: merge raw plugin inventory with wordpress.org versions"
```

---

### Task 10: Coletor único e ligação nas rotas

**Files:**
- Modify: `src/lib/wp-rest.ts` (acrescentar `collectPlugins`)
- Modify: `src/app/api/plugins/route.ts`
- Modify: `src/app/api/cron/scan/route.ts`
- Modify: `sql/006_scan_update_source.sql` (novo)

- [ ] **Step 1: Persistir `update_source`**

Create `sql/006_scan_update_source.sql`:

```sql
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
```

Run: `npm run db:migrate`
Expected: `✓ 006_scan_update_source.sql (1 statements)`

- [ ] **Step 2: Gravar a coluna nova**

Modify `src/lib/db.ts`, na função `saveScan`, no `INSERT INTO scan_plugins` — troque o bloco inteiro por:

```ts
    await sql`
      INSERT INTO scan_plugins (scan_id, file, name, version, new_version, is_active, has_update, update_source)
      SELECT ${scanId}, * FROM unnest(
        ${list.map((p) => p.file || p.name)}::text[],
        ${list.map((p) => p.name)}::text[],
        ${list.map((p) => p.version)}::text[],
        ${list.map((p) => p.new_version)}::text[],
        ${list.map((p) => p.is_active)}::boolean[],
        ${list.map((p) => p.has_update)}::boolean[],
        ${list.map((p) => p.update_source)}::text[]
      )
      ON CONFLICT (scan_id, file) DO NOTHING
    `;
```

E em `scanPlugins`, inclua a coluna no SELECT:

```ts
  return (await sql`
    SELECT file, name, version, new_version, is_active, has_update, update_source
      FROM scan_plugins WHERE scan_id = ${scanId} ORDER BY name
  `) as Plugin[];
```

- [ ] **Step 3: Adicionar o coletor completo**

Modify `src/lib/wp-rest.ts`, ao final do arquivo:

```ts
import { latestVersions } from './wporg';
import { mergePluginVersions } from './inventory';
import type { Plugin } from './types';

/**
 * Varredura completa de plugins: lê o site, cruza com o wordpress.org e
 * devolve o tipo que a UI e o histórico já consomem.
 */
export async function collectPlugins(site: string, credential: Credential): Promise<Plugin[]> {
  const raw = await fetchRawPlugins(site, credential);
  const latest = await latestVersions(raw.map((p) => p.slug));
  return mergePluginVersions(raw, latest);
}
```

- [ ] **Step 4: Trocar a rota manual**

Modify `src/app/api/plugins/route.ts`. Troque o import de `wp`:

```ts
import { collectPlugins, WpError } from '@/lib/wp-rest';
import { getCredential, markCredentialResult } from '@/lib/credentials';
import { SecretPayloadError } from '@/lib/crypto';
```

E substitua o bloco `let plugins; try { plugins = await fetchSitePlugins(site); } catch ...` por:

```ts
  // Duas falhas de credencial, duas remediações opostas — não colapse as duas.
  // CredentialsKeyError = CREDENTIALS_KEY ausente/errada: a frota inteira está
  // fora, é problema de ambiente, propaga como 500.
  // SecretPayloadError = o payload daquele site não decifra: problema de um
  // site só, o dono precisa cadastrar a senha de novo.
  let credential;
  try {
    credential = await getCredential(row.id);
  } catch (err) {
    if (err instanceof SecretPayloadError) {
      await markCredentialResult(row.id, 'Credencial armazenada ilegível.');
      return fail(
        400,
        'bad_credential',
        'A credencial gravada para este site não pôde ser lida. Cadastre a Application Password novamente.',
      );
    }
    throw err; // CredentialsKeyError e o resto sobem: é falha de servidor.
  }

  if (!credential) {
    return fail(
      400,
      'no_credential',
      'Este site ainda não tem Application Password cadastrada. Cadastre em Configurações do site.',
    );
  }

  let plugins;
  try {
    plugins = await collectPlugins(site, credential);
    await markCredentialResult(row.id, null);
  } catch (err) {
    const wpErr = err instanceof WpError ? err : new WpError('network', 502, 'Erro inesperado ao consultar o site.');
    // O erro também vira histórico: saber quando o site parou de responder importa.
    await saveScan({ siteId: row.id, source: 'manual', errorKind: wpErr.kind, errorMessage: wpErr.message });
    await markCredentialResult(row.id, wpErr.message);
    return fail(wpErr.status, wpErr.kind, wpErr.message, wpErr.detail);
  }
```

- [ ] **Step 5: Trocar o cron**

Modify `src/app/api/cron/scan/route.ts`. Troque o import:

```ts
import { collectPlugins, WpError } from '@/lib/wp-rest';
import { getCredential, markCredentialResult } from '@/lib/credentials';
```

E substitua o corpo do `worker()` por:

```ts
  async function worker() {
    for (let site = queue.shift(); site; site = queue.shift()) {
      // Credencial ilegível é problema de um site; não pode derrubar a
      // varredura dos outros. Já CredentialsKeyError sobe e aborta o cron
      // inteiro de propósito: sem a chave, nenhum site seria varrido mesmo.
      let credential;
      try {
        credential = await getCredential(site.id);
      } catch (err) {
        if (!(err instanceof SecretPayloadError)) throw err;
        await saveScan({
          siteId: site.id,
          source: 'cron',
          errorKind: 'bad_credential',
          errorMessage: 'Credencial armazenada ilegível.',
        });
        await markCredentialResult(site.id, 'Credencial armazenada ilegível.');
        results.push({ url: site.url, ok: false, error: 'credencial ilegível' });
        continue;
      }

      if (!credential) {
        await saveScan({
          siteId: site.id,
          source: 'cron',
          errorKind: 'no_credential',
          errorMessage: 'Site sem Application Password cadastrada.',
        });
        results.push({ url: site.url, ok: false, error: 'sem credencial' });
        continue;
      }
      try {
        const plugins = await collectPlugins(site.url, credential);
        await saveScan({ siteId: site.id, source: 'cron', plugins });
        await markCredentialResult(site.id, null);
        results.push({ url: site.url, ok: true, outdated: plugins.filter((p) => p.has_update).length });
      } catch (err) {
        const wpErr = err instanceof WpError ? err : new WpError('network', 502, 'Erro inesperado.');
        await saveScan({ siteId: site.id, source: 'cron', errorKind: wpErr.kind, errorMessage: wpErr.message });
        await markCredentialResult(site.id, wpErr.message);
        results.push({ url: site.url, ok: false, error: wpErr.message });
      }
    }
  }
```

- [ ] **Step 6: Verificar tipos e testes**

Run: `npx tsc --noEmit -p tsconfig.json && npm test`
Expected: sem erros; todos os testes passando.

- [ ] **Step 7: Commit**

```bash
git add sql/006_scan_update_source.sql src/lib/db.ts src/lib/wp-rest.ts src/app/api/plugins/route.ts src/app/api/cron/scan/route.ts
git commit -m "feat: collect plugins through authenticated REST path"
```

---

### Task 11: UI de cadastro da credencial

**Files:**
- Create: `src/components/CredentialForm.tsx`
- Modify: `src/app/actions.ts`
- Modify: `src/components/SavedSites.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Server Actions**

Modify `src/app/actions.ts`, ao final, antes de `signOutAction`:

```ts
/* ── credenciais de site ───────────────────────────────────────────────── */

import { deleteCredential, saveCredential } from '@/lib/credentials';

export async function saveCredentialAction(
  siteId: string,
  wpUser: string,
  appPassword: string,
): Promise<ActionResult> {
  const user = await requireUser();

  const cleanUser = wpUser.trim();
  // O WordPress mostra a Application Password em grupos de 4; aceitar com e sem
  // espaço evita o erro mais comum de colagem.
  const cleanPassword = appPassword.trim();

  if (!cleanUser) return { ok: false, error: 'Informe o usuário do WordPress.' };
  if (cleanPassword.length < 16) return { ok: false, error: 'Application Password parece curta demais.' };

  try {
    await saveCredential(user.id, siteId, cleanUser, cleanPassword);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Não foi possível salvar.' };
  }

  revalidatePath('/');
  return { ok: true, url: '' };
}

export async function deleteCredentialAction(siteId: string): Promise<void> {
  const user = await requireUser();
  await deleteCredential(user.id, siteId);
  revalidatePath('/');
}
```

- [ ] **Step 2: Componente do formulário**

Create `src/components/CredentialForm.tsx`:

```tsx
'use client';

// Cadastro da Application Password de um site.
//
// A senha só existe aqui no caminho de ida: é enviada à Server Action, cifrada
// e gravada. Nunca volta do servidor, nem mascarada.

import { useState, useTransition } from 'react';
import { deleteCredentialAction, saveCredentialAction } from '@/app/actions';

export type CredentialInfo = {
  wp_user: string;
  last_verified_at: string | null;
  last_error: string | null;
};

type Props = {
  siteId: string;
  siteUrl: string;
  current: CredentialInfo | null;
};

export function CredentialForm({ siteId, siteUrl, current }: Props) {
  const [wpUser, setWpUser] = useState(current?.wp_user ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await saveCredentialAction(siteId, wpUser, password);
      if (!result.ok) setError(result.error);
      else setPassword('');
    });
  }

  return (
    <form className="cred" onSubmit={handleSubmit}>
      <div className="eyebrow">Credencial de leitura</div>

      <p className="cred-help">
        No wp-admin de <span className="mono">{siteUrl}</span>: Usuários → Perfil →
        Senhas de aplicativo. Precisa ser conta de administrador — ler a lista de
        plugins exige a capability <span className="mono">activate_plugins</span>.
      </p>

      <label htmlFor={`u-${siteId}`}>Usuário</label>
      <input
        id={`u-${siteId}`}
        value={wpUser}
        onChange={(e) => setWpUser(e.target.value)}
        autoComplete="off"
        placeholder="admin"
      />

      <label htmlFor={`p-${siteId}`}>Application Password</label>
      <input
        id={`p-${siteId}`}
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="off"
        placeholder={current ? '•••• já cadastrada — preencha para substituir' : 'abcd EFGH ijkl MNOP qrst UVWX'}
      />

      {error && <p className="cred-error">{error}</p>}

      {current?.last_error && (
        <p className="cred-error">Última tentativa falhou: {current.last_error}</p>
      )}

      {current?.last_verified_at && !current.last_error && (
        <p className="cred-ok">
          Funcionando · verificada em {new Date(current.last_verified_at).toLocaleString('pt-BR')}
        </p>
      )}

      <div className="cred-actions">
        <button type="submit" disabled={pending}>
          {pending ? 'Salvando…' : current ? 'Substituir' : 'Salvar'}
        </button>
        {current && (
          <button
            type="button"
            className="ghost"
            disabled={pending}
            onClick={() => startTransition(() => deleteCredentialAction(siteId))}
          >
            Remover
          </button>
        )}
      </div>
    </form>
  );
}
```

- [ ] **Step 3: Estilos**

Modify `src/app/globals.css`, ao final:

```css
/* ── credencial por site ─────────────────────────────────────────────── */
.cred { display: grid; gap: 8px; padding: 16px; border: 1px solid var(--line); }
.cred-help { font-size: 13px; line-height: 1.5; color: var(--muted); margin: 0 0 4px; }
.cred label { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
.cred input { padding: 8px 10px; border: 1px solid var(--line); background: transparent; font: inherit; }
.cred-error { font-size: 13px; color: var(--hot); margin: 0; }
.cred-ok { font-size: 13px; color: var(--muted); margin: 0; }
.cred-actions { display: flex; gap: 8px; margin-top: 4px; }
```

> Confira os nomes reais das variáveis em `src/app/globals.css` antes de colar — o design system v3 pode usar outros tokens. Não invente token novo.

- [ ] **Step 4: Carregar o status no servidor**

Modify `src/app/page.tsx`, onde os sites são montados, acrescentando o status da credencial de cada site via `credentialStatus(user.id, site.id)`. Passe o resultado para o `Dashboard` no mesmo objeto de cada site, como `credential`.

- [ ] **Step 5: Verificar no navegador**

Run: `npm run dev`
Cadastre a credencial de um site real e clique em Recarregar. Esperado: a tabela carrega pelo caminho novo e o rodapé de `last_verified_at` aparece.

- [ ] **Step 6: Commit**

```bash
git add src/components/CredentialForm.tsx src/app/actions.ts src/app/page.tsx src/app/globals.css
git commit -m "feat: add per-site Application Password form"
```

---

### Task 12: Tornar a cobertura parcial visível

Consequência direta de D-B/D-D. Sem isso o painel afirma "em dia" para plugin premium sobre o qual não sabe nada.

**Files:**
- Modify: `src/components/PluginTable.tsx`
- Modify: `src/components/StatsRow.tsx`

- [ ] **Step 1: Marcar a linha**

Modify `src/components/PluginTable.tsx`, na célula de status, troque o `<span className={...}>` do badge por:

```tsx
                  <td data-col="status">
                    <span className={`badge ${status.className}`}>{status.label}</span>
                    {p.update_source === 'unknown' && (
                      <span
                        className="badge badge-unknown"
                        title="Plugin fora do repositório oficial do WordPress. Não temos como saber se há versão mais nova."
                      >
                        atualização desconhecida
                      </span>
                    )}
                  </td>
```

- [ ] **Step 2: Rodapé honesto nas métricas**

Modify `src/components/StatsRow.tsx`, substitua o corpo do componente por:

```tsx
export function StatsRow({ plugins }: { plugins: Plugin[] }) {
  const s = computeStats(plugins);
  const pct = s.total > 0 ? Math.round((s.active / s.total) * 100) : 0;
  const unknown = plugins.filter((p) => p.update_source === 'unknown').length;

  return (
    <>
      <div className="stats">
        <div className="stat"><b>{s.total}</b><span className="eyebrow">Plugins</span></div>
        <div className="stat ok"><b>{s.active}</b><span className="eyebrow">Ativos · {pct}% do total</span></div>
        <div className="stat hot"><b>{s.outdated}</b><span className="eyebrow">Com atualização pendente</span></div>
        <div className="stat"><b>{s.inactive}</b><span className="eyebrow">Inativos</span></div>
      </div>
      {unknown > 0 && (
        <p className="coverage">
          {unknown} {unknown === 1 ? 'plugin não está' : 'plugins não estão'} no repositório oficial
          do WordPress — para {unknown === 1 ? 'ele' : 'eles'}, não é possível saber se há atualização.
        </p>
      )}
    </>
  );
}
```

- [ ] **Step 3: Estilos**

Modify `src/app/globals.css`, ao final:

```css
.badge-unknown { margin-left: 6px; opacity: .7; font-style: italic; }
.coverage { font-size: 13px; color: var(--muted); margin: 8px 0 0; }
```

- [ ] **Step 4: Corrigir as telas de erro**

`src/components/States.tsx` tem `const PLUGINS_PATH = '/wp-json/site-status/v1/plugins'` no topo, usado no texto do loading e na copy do 404. Depois desta migração esse caminho não existe mais, e o `switch (kind)` em `errorCopy` não cobre os três `ApiErrorKind` novos.

Modify `src/components/States.tsx`, linha 8:

```tsx
const PLUGINS_PATH = '/wp-json/wp/v2/plugins';
```

E acrescente os três casos ao `switch (kind)` de `errorCopy`, antes do `default`:

```tsx
    case 'no_credential':
      return {
        title: 'Site sem credencial',
        body: (
          <>
            Este site ainda não tem Application Password cadastrada. Gere uma no wp-admin
            em Usuários → Perfil → Senhas de aplicativo e cadastre aqui.
          </>
        ),
      };
    case 'bad_credential':
      return {
        title: 'Credencial ilegível',
        body: (
          <>
            A credencial gravada para este site não pôde ser decifrada — provavelmente a
            <code>CREDENTIALS_KEY</code> do servidor mudou depois que ela foi salva.
            Cadastre a Application Password novamente.
          </>
        ),
      };
    case 'unauthorized':
      return {
        title: 'Credencial recusada · 401',
        body: (
          <>
            O WordPress rejeitou a Application Password. Ela pode ter sido revogada — ou o
            servidor está descartando o cabeçalho <code>Authorization</code>, o que é comum
            em Apache/CGI e se resolve com uma regra no <code>.htaccess</code>.
          </>
        ),
      };
    case 'forbidden':
      return {
        title: 'Sem permissão · 403',
        body: (
          <>
            O usuário autenticou mas não tem permissão para ler plugins. Essa leitura exige a
            capability <code>activate_plugins</code> — na prática, uma conta de administrador.
          </>
        ),
      };
```

Também corrija a copy do caso `not_found`, que hoje diz "confirme se o plugin que expõe o status está instalado": com a REST nativa, 404 significa REST API desabilitada no site, não plugin ausente.

- [ ] **Step 5: Verificar**

Run: `npx tsc --noEmit -p tsconfig.json && npm run dev`
Esperado: sem erro de tipo; um site com plugin premium mostra o selo "atualização desconhecida" e a contagem no rodapé; um site sem credencial mostra a tela "Site sem credencial".

- [ ] **Step 6: Commit**

```bash
git add src/components/PluginTable.tsx src/components/StatsRow.tsx src/components/States.tsx src/app/globals.css
git commit -m "feat: surface unknown update coverage and credential error states"
```

**Fim da Fase 1.** O painel funciona ponta a ponta pelo caminho novo. Pode parar aqui e entregar.

---

## Fase 2 — Inventário ampliado

### Task 13: Schema de temas, usuários e settings

**Files:**
- Create: `sql/007_inventory.sql`

- [ ] **Step 1: Migration**

Create `sql/007_inventory.sql`:

```sql
-- Snapshots dos demais recursos que a Application Password abre.
-- Mesma regra dos plugins: imutável, um por scan.

CREATE TABLE IF NOT EXISTS scan_themes (
  scan_id     uuid NOT NULL REFERENCES scans (id) ON DELETE CASCADE,
  stylesheet  text NOT NULL,
  name        text NOT NULL,
  version     text NOT NULL DEFAULT '',
  is_active   boolean NOT NULL DEFAULT false,
  PRIMARY KEY (scan_id, stylesheet)
);

CREATE TABLE IF NOT EXISTS scan_users (
  scan_id   uuid NOT NULL REFERENCES scans (id) ON DELETE CASCADE,
  wp_user_id integer NOT NULL,
  slug      text NOT NULL DEFAULT '',
  name      text NOT NULL DEFAULT '',
  roles     text NOT NULL DEFAULT '',
  PRIMARY KEY (scan_id, wp_user_id)
);

CREATE TABLE IF NOT EXISTS scan_settings (
  scan_id      uuid PRIMARY KEY REFERENCES scans (id) ON DELETE CASCADE,
  title        text NOT NULL DEFAULT '',
  description  text NOT NULL DEFAULT '',
  url          text NOT NULL DEFAULT '',
  admin_email  text NOT NULL DEFAULT '',
  timezone     text NOT NULL DEFAULT '',
  language     text NOT NULL DEFAULT ''
);
```

> `scan_users.roles` guarda a lista separada por vírgula. Não normalize em tabela
> própria: o dado é lido em bloco e nunca consultado por papel isolado. YAGNI.

- [ ] **Step 2: Aplicar e liberar para o MCP**

```bash
npm run db:migrate
```

Modify `scripts/setup-reader-role.mjs`, no array `READ_TABLES`:

```js
const READ_TABLES = ['app_users', 'sites', 'scans', 'scan_plugins', 'scan_themes', 'scan_users', 'scan_settings'];
```

Run: `npm run db:reader`

> Note o contraste com a Task 5: estas tabelas **entram** na lista de leitura do
> MCP; `site_credentials` continua fora. Inventário é para ler; segredo não.

- [ ] **Step 3: Commit**

```bash
git add sql/007_inventory.sql scripts/setup-reader-role.mjs
git commit -m "feat: add themes, users and settings snapshot tables"
```

---

### Task 14: Leitura dos três recursos

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/wp-rest.ts`
- Test: `src/lib/wp-rest.test.ts`

- [ ] **Step 1: Tipos**

Modify `src/lib/types.ts`, ao final:

```ts
export type Theme = {
  stylesheet: string;
  name: string;
  version: string;
  is_active: boolean;
};

export type WpUser = {
  wp_user_id: number;
  slug: string;
  name: string;
  roles: string;
};

export type WpSettings = {
  title: string;
  description: string;
  url: string;
  admin_email: string;
  timezone: string;
  language: string;
};

/** Recursos opcionais do inventário, além de plugins. */
export type InventoryResource = 'themes' | 'users' | 'settings';

export type SiteInventory = {
  plugins: Plugin[];
  themes: Theme[];
  users: WpUser[];
  settings: WpSettings | null;
  /**
   * Recursos que não puderam ser lidos, com o motivo. Vazio = tudo leu.
   *
   * Existe para que a UI distinga "este site não tem usuários" de "não
   * conseguimos ler os usuários" — sem isso, um 403 em /wp/v2/users (falta a
   * capability list_users) vira uma aba vazia que parece um fato.
   */
  failures: Partial<Record<InventoryResource, string>>;
};
```

- [ ] **Step 2: Teste que falha**

Modify `src/lib/wp-rest.test.ts`, acrescentando ao final:

```ts
import { fetchThemes, fetchUsers, fetchSettings } from './wp-rest';

describe('recursos adicionais', () => {
  it('normaliza temas e identifica o ativo', async () => {
    vi.stubGlobal('fetch', mockFetch(200, [
      { stylesheet: 'twentytwentyfour', name: { raw: 'Twenty Twenty-Four' }, version: '1.2', status: 'active' },
      { stylesheet: 'astra', name: { raw: 'Astra' }, version: '4.6.0', status: 'inactive' },
    ]));

    const themes = await fetchThemes('https://exemplo.com', CRED);
    expect(themes).toEqual([
      { stylesheet: 'twentytwentyfour', name: 'Twenty Twenty-Four', version: '1.2', is_active: true },
      { stylesheet: 'astra', name: 'Astra', version: '4.6.0', is_active: false },
    ]);
  });

  it('usuários trazem papéis achatados em string', async () => {
    vi.stubGlobal('fetch', mockFetch(200, [
      { id: 1, slug: 'admin', name: 'Admin', roles: ['administrator'] },
      { id: 4, slug: 'editora', name: 'Editora', roles: ['editor', 'author'] },
    ]));

    const users = await fetchUsers('https://exemplo.com', CRED);
    expect(users).toEqual([
      { wp_user_id: 1, slug: 'admin', name: 'Admin', roles: 'administrator' },
      { wp_user_id: 4, slug: 'editora', name: 'Editora', roles: 'editor,author' },
    ]);
  });

  it('settings vira objeto chato com defaults', async () => {
    vi.stubGlobal('fetch', mockFetch(200, {
      title: 'Meu Site', description: 'Só outro site', url: 'https://exemplo.com',
      email: 'admin@exemplo.com', timezone: 'America/Sao_Paulo', language: 'pt_BR',
    }));

    expect(await fetchSettings('https://exemplo.com', CRED)).toEqual({
      title: 'Meu Site',
      description: 'Só outro site',
      url: 'https://exemplo.com',
      admin_email: 'admin@exemplo.com',
      timezone: 'America/Sao_Paulo',
      language: 'pt_BR',
    });
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run src/lib/wp-rest.test.ts`
Expected: FAIL — `fetchThemes is not a function`

- [ ] **Step 4: Implementar**

Modify `src/lib/wp-rest.ts`, ao final:

```ts
import type { SiteInventory, Theme, WpSettings, WpUser } from './types';

/** `name` e `description` podem vir como string ou como { raw, rendered }. */
function flatten(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.raw === 'string') return obj.raw;
    if (typeof obj.rendered === 'string') return obj.rendered;
  }
  return '';
}

export async function fetchThemes(site: string, credential: Credential): Promise<Theme[]> {
  const data = await wpGet(site, '/wp-json/wp/v2/themes', credential);
  if (!Array.isArray(data)) throw new WpError('bad_payload', 502, 'A resposta de /wp/v2/themes não é uma lista.');
  return data.map((raw) => {
    const t = (raw ?? {}) as Record<string, unknown>;
    return {
      stylesheet: typeof t.stylesheet === 'string' ? t.stylesheet : '',
      name: flatten(t.name),
      version: t.version != null ? String(t.version) : '',
      is_active: t.status === 'active',
    };
  });
}

export async function fetchUsers(site: string, credential: Credential): Promise<WpUser[]> {
  // context=edit é o que traz `roles`; exige capability list_users.
  const data = await wpGet(site, '/wp-json/wp/v2/users?context=edit&per_page=100', credential);
  if (!Array.isArray(data)) throw new WpError('bad_payload', 502, 'A resposta de /wp/v2/users não é uma lista.');
  return data.map((raw) => {
    const u = (raw ?? {}) as Record<string, unknown>;
    return {
      wp_user_id: Number(u.id ?? 0),
      slug: typeof u.slug === 'string' ? u.slug : '',
      name: flatten(u.name),
      roles: Array.isArray(u.roles) ? u.roles.join(',') : '',
    };
  });
}

export async function fetchSettings(site: string, credential: Credential): Promise<WpSettings> {
  const data = await wpGet(site, '/wp-json/wp/v2/settings', credential);
  const s = (data ?? {}) as Record<string, unknown>;
  return {
    title: flatten(s.title),
    description: flatten(s.description),
    url: typeof s.url === 'string' ? s.url : '',
    admin_email: typeof s.email === 'string' ? s.email : '',
    timezone: typeof s.timezone === 'string' ? s.timezone : '',
    language: typeof s.language === 'string' ? s.language : '',
  };
}

/**
 * Inventário completo. Plugins é obrigatório: se falhar, a varredura falhou.
 * Os outros três são best-effort — um 403 em /users (falta list_users) não pode
 * derrubar a varredura inteira de plugins.
 */
export async function collectInventory(site: string, credential: Credential): Promise<SiteInventory> {
  const plugins = await collectPlugins(site, credential);
  const failures: Partial<Record<InventoryResource, string>> = {};

  /** Best-effort com memória: guarda o motivo em vez de engolir a falha. */
  async function attempt<T>(resource: InventoryResource, run: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await run();
    } catch (err) {
      failures[resource] = err instanceof Error ? err.message : 'Falha desconhecida.';
      return fallback;
    }
  }

  const [themes, users, settings] = await Promise.all([
    attempt('themes', () => fetchThemes(site, credential), [] as Theme[]),
    attempt('users', () => fetchUsers(site, credential), [] as WpUser[]),
    attempt('settings', () => fetchSettings(site, credential), null as WpSettings | null),
  ]);

  return { plugins, themes, users, settings, failures };
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run src/lib/wp-rest.test.ts`
Expected: PASS — 10 testes.

- [ ] **Step 6: Commit**

```bash
git add src/lib/wp-rest.ts src/lib/wp-rest.test.ts src/lib/types.ts
git commit -m "feat: read themes, users and settings from WordPress REST"
```

---

### Task 15: Persistir o inventário ampliado

**Files:**
- Modify: `src/lib/db.ts`
- Modify: `src/app/api/plugins/route.ts`
- Modify: `src/app/api/cron/scan/route.ts`

- [ ] **Step 1: Gravar os três recursos**

Modify `src/lib/db.ts`, ao final:

```ts
import type { SiteInventory, Theme, WpSettings, WpUser } from './types';

/** Snapshots dos recursos além de plugins. Chamado logo após saveScan. */
export async function saveInventoryExtras(
  scanId: string,
  { themes, users, settings }: Omit<SiteInventory, 'plugins'>,
): Promise<void> {
  if (themes.length > 0) {
    await sql`
      INSERT INTO scan_themes (scan_id, stylesheet, name, version, is_active)
      SELECT ${scanId}, * FROM unnest(
        ${themes.map((t) => t.stylesheet)}::text[],
        ${themes.map((t) => t.name)}::text[],
        ${themes.map((t) => t.version)}::text[],
        ${themes.map((t) => t.is_active)}::boolean[]
      )
      ON CONFLICT (scan_id, stylesheet) DO NOTHING
    `;
  }

  if (users.length > 0) {
    await sql`
      INSERT INTO scan_users (scan_id, wp_user_id, slug, name, roles)
      SELECT ${scanId}, * FROM unnest(
        ${users.map((u) => u.wp_user_id)}::integer[],
        ${users.map((u) => u.slug)}::text[],
        ${users.map((u) => u.name)}::text[],
        ${users.map((u) => u.roles)}::text[]
      )
      ON CONFLICT (scan_id, wp_user_id) DO NOTHING
    `;
  }

  if (settings) {
    await sql`
      INSERT INTO scan_settings (scan_id, title, description, url, admin_email, timezone, language)
      VALUES (${scanId}, ${settings.title}, ${settings.description}, ${settings.url},
              ${settings.admin_email}, ${settings.timezone}, ${settings.language})
      ON CONFLICT (scan_id) DO NOTHING
    `;
  }
}

export async function scanThemes(scanId: string): Promise<Theme[]> {
  return (await sql`
    SELECT stylesheet, name, version, is_active FROM scan_themes
     WHERE scan_id = ${scanId} ORDER BY is_active DESC, name
  `) as Theme[];
}

export async function scanUsers(scanId: string): Promise<WpUser[]> {
  return (await sql`
    SELECT wp_user_id, slug, name, roles FROM scan_users
     WHERE scan_id = ${scanId} ORDER BY wp_user_id
  `) as WpUser[];
}

export async function scanSettings(scanId: string): Promise<WpSettings | null> {
  const rows = (await sql`
    SELECT title, description, url, admin_email, timezone, language
      FROM scan_settings WHERE scan_id = ${scanId}
  `) as WpSettings[];
  return rows[0] ?? null;
}
```

- [ ] **Step 2: Ligar nas rotas**

Em `src/app/api/plugins/route.ts`, troque `collectPlugins` por `collectInventory`, e depois do `saveScan`:

```ts
  const inventory = await collectInventory(site, credential);
  const scanId = await saveScan({ siteId: row.id, source: 'manual', plugins: inventory.plugins });
  await saveInventoryExtras(scanId, {
    themes: inventory.themes,
    users: inventory.users,
    settings: inventory.settings,
  });
```

E inclua `themes`, `users` e `settings` no corpo da resposta JSON, junto de `plugins`.

Faça o equivalente em `src/app/api/cron/scan/route.ts`.

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit -p tsconfig.json && npm test`
Expected: sem erros; testes passando.

- [ ] **Step 4: Commit**

```bash
git add src/lib/db.ts src/app/api/plugins/route.ts src/app/api/cron/scan/route.ts
git commit -m "feat: persist themes, users and settings snapshots"
```

---

### Task 16: Abas de inventário na UI

**Files:**
- Create: `src/components/InventoryTabs.tsx`
- Modify: `src/components/Dashboard.tsx`
- Modify: `src/lib/client-api.ts`

- [ ] **Step 1: Estender o contrato do cliente**

Modify `src/lib/client-api.ts`, no tipo de retorno de `fetchPlugins`, acrescentando `themes: Theme[]`, `users: WpUser[]` e `settings: WpSettings | null` ao `PluginsResponse` em `src/lib/types.ts`.

- [ ] **Step 2: Componente de abas**

Create `src/components/InventoryTabs.tsx`:

```tsx
'use client';

// Abas do inventário. Plugins continua sendo a aba padrão — é o motivo do painel
// existir; o resto é contexto.

import { useState } from 'react';
import { PluginTable } from '@/components/PluginTable';
import type { FilterKey } from '@/lib/plugins';
import type { Change } from '@/lib/diff';
import type { Plugin, Theme, WpSettings, WpUser } from '@/lib/types';

type TabKey = 'plugins' | 'themes' | 'users' | 'settings';

const TAB_LABEL: Record<TabKey, string> = {
  plugins: 'Plugins',
  themes: 'Temas',
  users: 'Usuários',
  settings: 'Configurações',
};

type Props = {
  plugins: Plugin[];
  themes: Theme[];
  users: WpUser[];
  settings: WpSettings | null;
  filter: FilterKey;
  onFilter: (key: FilterKey) => void;
  changes: Record<string, Change[]>;
};

export function InventoryTabs({ plugins, themes, users, settings, filter, onFilter, changes }: Props) {
  const [tab, setTab] = useState<TabKey>('plugins');

  const count: Record<TabKey, number> = {
    plugins: plugins.length,
    themes: themes.length,
    users: users.length,
    settings: settings ? 1 : 0,
  };

  return (
    <div className="inv">
      <div className="chips inv-tabs">
        {(Object.keys(TAB_LABEL) as TabKey[]).map((key) => (
          <button
            key={key}
            type="button"
            className={`chip${key === tab ? ' on' : ''}`}
            aria-pressed={key === tab}
            disabled={count[key] === 0 && key !== 'plugins'}
            onClick={() => setTab(key)}
          >
            {TAB_LABEL[key]}{key !== 'settings' && ` · ${count[key]}`}
          </button>
        ))}
      </div>

      {tab === 'plugins' && (
        <PluginTable plugins={plugins} filter={filter} onFilter={onFilter} changes={changes} />
      )}

      {tab === 'themes' && (
        <table>
          <thead>
            <tr><th style={{ width: '54%' }}>Tema</th><th style={{ width: '23%' }}>Versão</th><th style={{ width: '23%' }}>Status</th></tr>
          </thead>
          <tbody>
            {themes.map((t) => (
              <tr key={t.stylesheet}>
                <td><div className="pname">{t.name}</div><div className="pfile">{t.stylesheet}</div></td>
                <td><span className="ver">{t.version || '—'}</span></td>
                <td><span className={`badge ${t.is_active ? 'badge-active' : 'badge-inactive'}`}>{t.is_active ? 'Ativo' : 'Inativo'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {tab === 'users' && (
        <table>
          <thead>
            <tr><th style={{ width: '46%' }}>Usuário</th><th style={{ width: '24%' }}>Login</th><th style={{ width: '30%' }}>Papéis</th></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.wp_user_id}>
                <td><div className="pname">{u.name || '—'}</div></td>
                <td><span className="mono">{u.slug}</span></td>
                <td>
                  {u.roles.split(',').filter(Boolean).map((role) => (
                    <span
                      key={role}
                      className={`badge ${role === 'administrator' ? 'badge-active-outdated' : 'badge-inactive'}`}
                    >
                      {role}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {tab === 'settings' && settings && (
        <dl className="settings">
          <dt>Título</dt><dd>{settings.title || '—'}</dd>
          <dt>Descrição</dt><dd>{settings.description || '—'}</dd>
          <dt>URL</dt><dd className="mono">{settings.url || '—'}</dd>
          <dt>E-mail do admin</dt><dd className="mono">{settings.admin_email || '—'}</dd>
          <dt>Fuso</dt><dd>{settings.timezone || '—'}</dd>
          <dt>Idioma</dt><dd>{settings.language || '—'}</dd>
        </dl>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Trocar no Dashboard**

Modify `src/components/Dashboard.tsx`: no `View` do status `ok`, acrescente `themes`, `users` e `settings`; preencha-os em `query()` a partir da resposta; e substitua o `<PluginTable ... />` do bloco final por `<InventoryTabs ... />` passando os novos campos.

- [ ] **Step 4: Estilos**

Modify `src/app/globals.css`, ao final:

```css
.inv-tabs { margin-bottom: 12px; }
.settings { display: grid; grid-template-columns: max-content 1fr; gap: 8px 24px; padding: 16px; border: 1px solid var(--line); margin: 0; }
.settings dt { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
.settings dd { margin: 0; }
```

- [ ] **Step 5: Verificar**

Run: `npm run dev` e percorra as quatro abas num site real.

- [ ] **Step 6: Commit**

```bash
git add src/components/InventoryTabs.tsx src/components/Dashboard.tsx src/lib/client-api.ts src/lib/types.ts src/app/globals.css
git commit -m "feat: add inventory tabs for themes, users and settings"
```

---

## Fase 3 — MCP e limpeza

### Task 17: Expor o inventário novo no MCP

**Files:**
- Modify: `src/lib/mcp/queries.ts`
- Modify: `src/lib/mcp/tools.ts`
- Modify: `mcp/test/smoke.test.mjs`

- [ ] **Step 1: Queries**

Modify `src/lib/mcp/queries.ts`, ao final, seguindo o padrão das existentes (SQL fixo, parametrizado, sempre escopado por `ownerId` via join em `sites`):

```ts
/** Temas do scan mais recente de um site. */
export async function latestThemes(ownerId: string, siteId: string) {
  const sql = db();
  return (await sql`
    SELECT t.stylesheet, t.name, t.version, t.is_active
      FROM scan_themes t
      JOIN scans sc ON sc.id = t.scan_id
      JOIN sites s ON s.id = sc.site_id
     WHERE s.owner_id = ${ownerId} AND s.id = ${siteId}
       AND sc.id = (SELECT id FROM scans WHERE site_id = ${siteId} AND ok = true ORDER BY fetched_at DESC LIMIT 1)
     ORDER BY t.is_active DESC, t.name
  `) as Array<{ stylesheet: string; name: string; version: string; is_active: boolean }>;
}

/** Usuários do scan mais recente — útil para auditar quantos admins existem. */
export async function latestUsers(ownerId: string, siteId: string) {
  const sql = db();
  return (await sql`
    SELECT u.wp_user_id, u.slug, u.name, u.roles
      FROM scan_users u
      JOIN scans sc ON sc.id = u.scan_id
      JOIN sites s ON s.id = sc.site_id
     WHERE s.owner_id = ${ownerId} AND s.id = ${siteId}
       AND sc.id = (SELECT id FROM scans WHERE site_id = ${siteId} AND ok = true ORDER BY fetched_at DESC LIMIT 1)
     ORDER BY u.wp_user_id
  `) as Array<{ wp_user_id: number; slug: string; name: string; roles: string }>;
}
```

- [ ] **Step 2: Duas tools novas**

Modify `src/lib/mcp/tools.ts`, seguindo exatamente o padrão das 8 existentes (`registerTool`, `READ_ONLY`, `reply`, `siteOrError`):

```ts
  /* ── 9. get_site_themes ──────────────────────────────────────────────── */
  server.registerTool(
    'get_site_themes',
    {
      title: 'Temas instalados',
      description: 'Temas instalados no site na varredura mais recente, com versão e qual está ativo.',
      inputSchema: { site_url: z.string().describe('URL do site, ex.: https://exemplo.com') },
      annotations: READ_ONLY,
    },
    async ({ site_url }) => {
      const found = await siteOrError(site_url);
      if (!found.ok) return fail(found.error);
      const themes = await q.latestThemes(ownerId, found.site.id);
      if (themes.length === 0) return reply('Nenhum tema registrado para este site.', []);
      const active = themes.find((t) => t.is_active);
      return reply(
        `${themes.length} tema(s) em ${displayUrl(found.site.url)}. Ativo: ${active ? `${active.name} ${active.version}` : 'nenhum identificado'}.`,
        themes,
      );
    },
  );

  /* ── 10. get_site_users ──────────────────────────────────────────────── */
  server.registerTool(
    'get_site_users',
    {
      title: 'Usuários do site',
      description:
        'Usuários do WordPress na varredura mais recente, com papéis. Útil para auditar quantas contas de administrador existem.',
      inputSchema: { site_url: z.string().describe('URL do site, ex.: https://exemplo.com') },
      annotations: READ_ONLY,
    },
    async ({ site_url }) => {
      const found = await siteOrError(site_url);
      if (!found.ok) return fail(found.error);
      const users = await q.latestUsers(ownerId, found.site.id);
      if (users.length === 0) return reply('Nenhum usuário registrado para este site.', []);
      const admins = users.filter((u) => u.roles.split(',').includes('administrator')).length;
      return reply(
        `${users.length} usuário(s) em ${displayUrl(found.site.url)}, ${admins} com papel de administrador.`,
        users,
      );
    },
  );
```

- [ ] **Step 3: Atualizar o teste de catálogo**

Modify `mcp/test/smoke.test.mjs`, no array `EXPECTED_TOOLS`, acrescentando `'get_site_themes'` e `'get_site_users'` — mantenha a ordem alfabética do array existente.

- [ ] **Step 4: Rodar a suíte do MCP**

Run: `npm run mcp:test`
Expected: todos os testes passando, agora com 10 tools no catálogo.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mcp/queries.ts src/lib/mcp/tools.ts mcp/test/smoke.test.mjs
git commit -m "feat: expose themes and users through MCP"
```

---

### Task 18: Remover o caminho antigo e atualizar a documentação

**Files:**
- Delete: `src/lib/wp.ts`
- Modify: `README.md`
- Modify: `.env.local` / variáveis da Vercel

- [ ] **Step 1: Confirmar que nada mais importa `wp.ts`**

Run: `grep -rn "lib/wp'" src/ ; grep -rn "fetchSitePlugins" src/ mcp/src/`
Expected: nenhuma saída. Se houver, migre a chamada antes de apagar.

- [ ] **Step 2: Remover**

```bash
git rm src/lib/wp.ts
```

- [ ] **Step 2b: Corrigir os comentários de contrato que apontam para o arquivo removido**

`src/app/api/plugins/route.ts:4` ainda diz:

```
// CONTRATO: só GET sai daqui para o WordPress (ver src/lib/wp.ts). A escrita
```

Comentário de segurança apontando para arquivo que não existe mais é pior do
que nenhum. Troque a referência por `src/lib/wp-rest.ts` e diga o que mudou de
fato — a garantia deixou de vir da ausência de credencial e passou a vir da
disciplina do módulo:

```ts
// CONTRATO: só GET sai daqui para o WordPress (ver src/lib/wp-rest.ts, que é o
// único ponto de saída). A credencial usada TEM poder de escrita no WordPress —
// Application Password não tem escopo no core — então a garantia de somente
// leitura é imposta por aquele módulo, não pela credencial. A escrita acontece
// apenas no nosso Postgres.
```

Varra o resto da árvore por outras referências penduradas antes de seguir:

```bash
grep -rn "lib/wp\b\|lib/wp\.ts\|site-status/v1" src/ docs/ README.md
```

Cada ocorrência ou vira `wp-rest`, ou é texto histórico que deve dizer
explicitamente que descreve o desenho antigo.

- [ ] **Step 3: Reescrever a seção de segurança do README**

Modify `README.md`. A seção "Garantia de somente leitura" deixou de ser verdadeira como estava escrita. Substitua por:

```markdown
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

A barreira 3 é reaplicada toda vez que `npm run db:reader` roda, porque o script
concede `SELECT` por padrão em tabelas novas.

### Cobertura de `has_update`

O core do WordPress não expõe atualização pendente por REST — esse dado vive no
transient `update_plugins`. O painel calcula comparando a versão instalada com a
publicada em `api.wordpress.org`. **Plugin fora do repositório oficial (premium ou
customizado) aparece marcado como "atualização desconhecida"** e nunca é contado
como em dia.
```

Atualize também a tabela de variáveis de ambiente do README, acrescentando:

| var | origem | para quê |
|---|---|---|
| `CREDENTIALS_KEY` | gerado local (32 bytes base64) | cifra as Application Passwords |

- [ ] **Step 4: Configurar na Vercel**

Adicione `CREDENTIALS_KEY` às variáveis do projeto na Vercel e redeploye.

> **A chave não pode ser perdida nem rotacionada sem plano:** trocá-la torna toda
> credencial já gravada indecifrável, e cada cliente precisa cadastrar de novo.
> Guarde-a onde as outras credenciais do projeto moram.

- [ ] **Step 5: Rodar tudo**

Run: `npm test && npm run mcp:test && npm run build`
Expected: tudo verde.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: remove custom-endpoint collector, document credential model"
```

---

## ADR para `decisoes.md`

Registrar no vault ao concluir:

```markdown
## D-009 — Coleta via Application Password, sem plugin próprio
- **data:** 2026-09-20
- **status:** vigente
- **contexto:** O dash-f2f dependia de `/wp-json/site-status/v1/plugins`, endpoint
  de um plugin que nunca foi escrito e cujo dono era indefinido. Além disso, um
  endpoint público que lista plugin e versão é mapa de superfície de ataque.
- **decisão:** Ler a REST API nativa do WordPress com Application Password por
  site, cifrada em AES-256-GCM com chave em env var. `has_update` passa a ser
  calculado contra api.wordpress.org.
- **alternativas:** (a) escrever o plugin próprio — descartada por exigir
  instalação em cada cliente; (b) híbrido App Password + plugin leve só para o
  transient `update_plugins` — descartada pelo mesmo motivo, apesar de dar
  `has_update` confiável; (c) contratar mcpwordpress.com.br — descartada: não tem
  tool de inventário de plugins, e US$150/mês por 10 domínios não cobre a frota.
- **consequência:** O painel passa a guardar credencial de admin de cada site
  monitorado — o raio de explosão de um vazamento nosso deixa de ser "inventário
  exposto" e vira "backdoor instalável na frota". Exige `CREDENTIALS_KEY` em
  produção, revogação permanente do acesso do MCP a `site_credentials`, e
  aceita cobertura parcial de `has_update` em plugin premium.
- **sessão:** [[2026-09-20 - coleta-via-application-password]]
```

---

## Pendências que este plano abre

- [ ] Rotação de `CREDENTIALS_KEY` não tem caminho: hoje trocar a chave invalida toda credencial gravada. Desenhar re-cifra em lote antes que isso seja necessário.
- [ ] Sites atrás de WAF ou com `Authorization` descartado pelo servidor vão falhar com `unauthorized` sem que a causa seja óbvia. Um diagnóstico na UI ("o servidor parece estar descartando o cabeçalho Authorization") economizaria suporte.
- [ ] `has_update` não cobre plugin premium. Se isso virar problema real, a saída é o híbrido descartado na D-008.
- [ ] Temas também têm atualização pendente e o mesmo buraco de dado — este plano só resolve para plugins.
- [ ] `/wp/v2/users` exige `list_users`; em site onde falhar, a aba Usuários fica vazia sem explicação.
