// Migrations simples: roda cada arquivo de sql/ em ordem, uma vez.
// Uso: npm run db:migrate   (carrega .env.local via --env-file)

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL ausente. Rode com: npm run db:migrate');
  process.exit(1);
}

const sql = neon(url);
const dir = join(process.cwd(), 'sql');

await sql`
  CREATE TABLE IF NOT EXISTS _migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )
`;

const applied = new Set((await sql`SELECT name FROM _migrations`).map((r) => r.name));
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

for (const file of files) {
  if (applied.has(file)) {
    console.log(`· ${file} (já aplicada)`);
    continue;
  }
  // O driver HTTP roda uma instrução por chamada: quebra o arquivo em statements.
  const statements = readFileSync(join(dir, file), 'utf8')
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter((s) => s && !s.split('\n').every((l) => l.trim().startsWith('--')));

  for (const statement of statements) {
    await sql.query(statement);
  }
  await sql`INSERT INTO _migrations (name) VALUES (${file})`;
  console.log(`✓ ${file} (${statements.length} statements)`);
}

console.log('migrations em dia.');
