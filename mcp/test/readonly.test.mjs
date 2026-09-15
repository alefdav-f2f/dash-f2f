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
    () => sql`INSERT INTO sites (owner_id, url) VALUES ('x', 'https://nao-deveria.example')`,
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
