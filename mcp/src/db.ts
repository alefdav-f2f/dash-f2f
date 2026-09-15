// Conexão do MCP com o banco do dash-f2f.
//
// Usa DATABASE_URL_MCP — a connection string da role `dash_f2f_reader`, que tem
// GRANT SELECT e nada mais. Mesmo um bug aqui não consegue escrever.

import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

let cached: NeonQueryFunction<false, false> | null = null;

export function db(): NeonQueryFunction<false, false> {
  if (cached) return cached;

  const url = process.env.DATABASE_URL_MCP;
  if (!url) {
    throw new Error(
      'DATABASE_URL_MCP ausente. Rode `npm run db:reader` no projeto e aponte a env do MCP para essa string (a do usuário somente-leitura, nunca a DATABASE_URL do app).',
    );
  }
  cached = neon(url);
  return cached;
}

/** Resolve o e-mail configurado para o `owner_id` usado em todas as queries. */
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
