// Conector MCP remoto — é esta URL que se cola no Claude, no ChatGPT e afins.
//
//   https://dash-f2f.vercel.app/api/mcp?token=dashf2f_…
//
// O token é pessoal (dá para atribuir e revogar por conta), mas os dados não
// são mais escopados por dono: sites são compartilhados pela equipe inteira
// (sql/011_shared_sites.sql), então qualquer token válido — de dono num
// domínio permitido, não revogado — lê o inventário inteiro. `ownerForToken`
// (src/lib/tokens.ts) é o único portão: valida o token e o domínio do dono
// antes de este handler sequer criar o servidor MCP. Mesmas 10 ferramentas do
// MCP local (src/lib/mcp/tools.ts), mesma garantia de somente leitura — a
// conexão usa a role `dash_f2f_reader`.

import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { ReaderUnavailableError } from '@/lib/mcp/db';
import { createMcpServer } from '@/lib/mcp/tools';
import { ownerForToken } from '@/lib/tokens';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Aceita o token de duas formas:
 *  - `Authorization: Bearer …` — para clientes que deixam definir cabeçalho;
 *  - `?token=…` na URL — para clientes que só aceitam colar um endereço.
 */
function tokenFrom(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (header?.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  return new URL(request.url).searchParams.get('token');
}

function unauthorized(message: string) {
  return Response.json(
    { jsonrpc: '2.0', error: { code: -32001, message } },
    { status: 401, headers: { 'WWW-Authenticate': 'Bearer realm="dash-f2f"' } },
  );
}

async function handle(request: Request): Promise<Response> {
  const user = await ownerForToken(tokenFrom(request));
  if (!user) {
    return unauthorized(
      'Token ausente ou inválido. Gere um em /conectores e use a URL completa, com ?token=…',
    );
  }

  let transport: WebStandardStreamableHTTPServerTransport;
  try {
    // Stateless: cada requisição é independente, que é o que os conectores
    // hospedados esperam e o que funciona bem em função serverless.
    transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    const server = createMcpServer(user.email);
    await server.connect(transport);
  } catch (err) {
    if (err instanceof ReaderUnavailableError) {
      return Response.json(
        { jsonrpc: '2.0', error: { code: -32002, message: err.message } },
        { status: 503 },
      );
    }
    throw err;
  }

  return transport.handleRequest(request);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
