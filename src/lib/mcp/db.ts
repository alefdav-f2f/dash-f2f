// Conexão somente-leitura compartilhada pelos dois transportes do MCP
// (stdio local e HTTP remoto em /api/mcp).
//
// Usa DATABASE_URL_MCP — a string da role `dash_f2f_reader`, que só tem
// GRANT SELECT. Nunca cai para a DATABASE_URL do app: sem a role, o MCP não sobe.
//
// Sem `server-only` de propósito: este módulo também roda fora do Next, no
// servidor stdio.

import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

let cached: NeonQueryFunction<false, false> | null = null;

export class ReaderUnavailableError extends Error {}

export function db(): NeonQueryFunction<false, false> {
  if (cached) return cached;

  const url = process.env.DATABASE_URL_MCP;
  if (!url) {
    throw new ReaderUnavailableError(
      'DATABASE_URL_MCP ausente. Rode `npm run db:reader` e configure essa variável (a do usuário somente-leitura, nunca a DATABASE_URL do app).',
    );
  }
  cached = neon(url);
  return cached;
}

/** Resolve o e-mail para o `owner_id` usado em todas as queries. */
export async function resolveOwnerId(email: string): Promise<string> {
  const sql = db();
  const rows = (await sql`
    SELECT id FROM app_users WHERE lower(email) = lower(${email})
  `) as Array<{ id: string }>;

  if (rows.length === 0) {
    throw new Error(
      `Nenhum usuário com e-mail ${email} em app_users. O registro é criado no primeiro acesso autenticado ao painel — entre uma vez em /auth/sign-in e tente de novo.`,
    );
  }
  return rows[0].id;
}
