// Sobe o servidor MCP de verdade (stdio) e conversa com ele como um cliente MCP:
// handshake, catálogo de tools e uma chamada real.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const here = dirname(fileURLToPath(import.meta.url));
const serverEntry = join(here, '..', 'dist', 'mcp', 'src', 'server.js');

const EXPECTED_TOOLS = [
  'diff_scans',
  'find_plugin',
  'fleet_summary',
  'get_recent_changes',
  'get_scan_history',
  'get_site_health',
  'get_site_status',
  'get_site_themes',
  'get_site_users',
  'list_failing_sites',
  'list_outdated',
  'list_sites',
  'list_unhealthy_sites',
];

async function connect(env = undefined) {
  const client = new Client({ name: 'dash-f2f-smoke', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    env: env ?? {
      ...process.env,
      DATABASE_URL_MCP: process.env.DATABASE_URL_MCP,
      DASH_F2F_OWNER_EMAIL: process.env.DASH_F2F_OWNER_EMAIL,
    },
  });
  await client.connect(transport);
  return client;
}

test('servidor MCP responde ao handshake e expõe as 13 tools', async (t) => {
  assert.ok(process.env.DASH_F2F_OWNER_EMAIL, 'defina DASH_F2F_OWNER_EMAIL no .env.local');
  const client = await connect();
  t.after(() => client.close());

  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name).sort(), EXPECTED_TOOLS);

  // Toda tool precisa se declarar somente leitura.
  for (const tool of tools) {
    assert.equal(tool.annotations?.readOnlyHint, true, `${tool.name} não está marcada como readOnly`);
  }
});

test('fleet_summary devolve números coerentes', async (t) => {
  const client = await connect();
  t.after(() => client.close());

  const res = await client.callTool({ name: 'fleet_summary', arguments: {} });
  assert.ok(!res.isError);

  const data = JSON.parse(res.content[1].text);
  assert.equal(typeof data.sites, 'number');
  assert.ok(data.sites >= 0);
  assert.ok(data.sites_with_outdated <= data.sites);
});

test('sobe sem env do cliente, lendo o .env.local do projeto', async (t) => {
  // É assim que Claude Code / Desktop / Cursor sobem o servidor quando a config
  // não declara bloco `env`: nenhuma das duas variáveis chega pelo ambiente.
  const semEnv = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot };
  const client = await connect(semEnv);
  t.after(() => client.close());

  const { tools } = await client.listTools();
  assert.equal(tools.length, EXPECTED_TOOLS.length);

  const res = await client.callTool({ name: 'fleet_summary', arguments: {} });
  assert.ok(!res.isError, 'fleet_summary deveria responder mesmo sem env do cliente');
});

test('tool recusa site que não é da conta', async (t) => {
  const client = await connect();
  t.after(() => client.close());

  const res = await client.callTool({
    name: 'get_site_status',
    arguments: { site_url: 'https://site-de-outra-pessoa.example' },
  });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /não está cadastrado nesta conta/);
});
