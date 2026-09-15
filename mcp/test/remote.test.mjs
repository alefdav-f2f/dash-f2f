// Conector MCP remoto (/api/mcp): handshake por HTTP, autenticação por token e
// recusa de token inválido.
//
// Precisa de um servidor rodando. Por padrão usa http://localhost:3000; defina
// DASH_F2F_BASE_URL para apontar para produção.
// O token vem de DASH_F2F_TEST_TOKEN; sem ele, os testes são pulados.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

const BASE = process.env.DASH_F2F_BASE_URL ?? 'http://localhost:3000';
const TOKEN = process.env.DASH_F2F_TEST_TOKEN;
const skip = TOKEN ? false : 'defina DASH_F2F_TEST_TOKEN para rodar os testes do conector remoto';

async function connect(token) {
  const client = new Client({ name: 'dash-f2f-remote-test', version: '1.0.0' });
  const url = new URL(`${BASE}/api/mcp`);
  url.searchParams.set('token', token);
  await client.connect(new StreamableHTTPClientTransport(url));
  return client;
}

test('conector remoto responde ao handshake e lista as 8 tools', { skip }, async (t) => {
  const client = await connect(TOKEN);
  t.after(() => client.close());

  const { tools } = await client.listTools();
  assert.equal(tools.length, 8);
  for (const tool of tools) {
    assert.equal(tool.annotations?.readOnlyHint, true, `${tool.name} não está marcada como readOnly`);
  }
});

test('conector remoto responde uma chamada de ferramenta', { skip }, async (t) => {
  const client = await connect(TOKEN);
  t.after(() => client.close());

  const res = await client.callTool({ name: 'fleet_summary', arguments: {} });
  assert.ok(!res.isError);
  const data = JSON.parse(res.content[1].text);
  assert.equal(typeof data.sites, 'number');
});

test('token inválido é recusado com 401', { skip }, async () => {
  const res = await fetch(`${BASE}/api/mcp?token=dashf2f_token-que-nao-existe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  assert.equal(res.status, 401);
});

test('sem token é recusado com 401', { skip }, async () => {
  const res = await fetch(`${BASE}/api/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  assert.equal(res.status, 401);
});
