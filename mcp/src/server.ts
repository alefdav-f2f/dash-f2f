#!/usr/bin/env node
// MCP dash-f2f — transporte stdio (local).
//
// As ferramentas vivem em src/lib/mcp/tools.ts, compartilhadas com o conector
// remoto (/api/mcp). Aqui só resolvemos a conta e ligamos o stdio.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { loadLocalEnv } from './env';
import { resolveOwnerId } from '../../src/lib/mcp/db';
import { createMcpServer } from '../../src/lib/mcp/tools';

async function main() {
  // O cliente MCP pode não injetar nada: nesse caso lemos o .env.local do projeto.
  loadLocalEnv();

  const email = process.env.DASH_F2F_OWNER_EMAIL;
  if (!email) {
    throw new Error(
      'DASH_F2F_OWNER_EMAIL ausente. Configure o e-mail da conta do painel cujas informações este MCP deve expor.',
    );
  }

  // Valida a conta uma única vez, no boot: precisa existir em app_users e
  // estar num domínio permitido (resolveOwnerId recusa o resto). Sites são
  // compartilhados pela equipe, então o id resolvido não vai para as queries
  // — só serve para essa checagem e para ficar disponível a quem depurar.
  await resolveOwnerId(email);
  const server = createMcpServer(email);

  await server.connect(new StdioServerTransport());
  // stdout é do protocolo; log vai para stderr.
  console.error(`[dash-f2f-mcp] pronto — conta ${email}`);
}

main().catch((err) => {
  console.error('[dash-f2f-mcp]', err instanceof Error ? err.message : err);
  process.exit(1);
});
