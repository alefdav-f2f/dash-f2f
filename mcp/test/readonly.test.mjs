// A role do MCP tem que ser incapaz de escrever. Se este teste passar a falhar,
// a garantia de "somente leitura" deixou de existir no nível do banco.

import test from 'node:test';
import assert from 'node:assert/strict';
import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL_MCP;

test('DATABASE_URL_MCP está configurada', () => {
  assert.ok(url, 'rode `npm run db:reader` antes dos testes');
});

test('a role do MCP consegue ler', async () => {
  const sql = neon(url);
  const rows = await sql`SELECT count(*)::int AS n FROM sites`;
  assert.equal(typeof rows[0].n, 'number');
});

test('a role do MCP não consegue inserir', async () => {
  const sql = neon(url);
  await assert.rejects(
    () => sql`INSERT INTO sites (added_by, url) VALUES ('x', 'https://nao-deveria.example')`,
    (err) => /permission denied/i.test(err.message),
  );
});

test('a role do MCP não consegue apagar nem atualizar', async () => {
  const sql = neon(url);
  await assert.rejects(() => sql`DELETE FROM scans`, (err) => /permission denied/i.test(err.message));
  await assert.rejects(
    () => sql`UPDATE sites SET url = 'https://nao-deveria.example'`,
    (err) => /permission denied/i.test(err.message),
  );
});

// Compartilhar sites entre a equipe não muda isto: segredo continua fora do
// allow-list de scripts/setup-reader-role.mjs, e não tem nada a ver com quem
// é dono de quê. Se estes dois testes passarem a falhar, a role do MCP ganhou
// leitura sobre credencial de site ou sobre token de outra pessoa — e o
// conector remoto, público em /api/mcp, passaria a poder vazar as duas coisas.
test('a role do MCP não consegue ler site_credentials', async () => {
  const sql = neon(url);
  await assert.rejects(
    () => sql`SELECT * FROM site_credentials LIMIT 1`,
    (err) => /permission denied/i.test(err.message),
  );
});

test('a role do MCP não consegue ler api_tokens', async () => {
  const sql = neon(url);
  await assert.rejects(
    () => sql`SELECT * FROM api_tokens LIMIT 1`,
    (err) => /permission denied/i.test(err.message),
  );
});
