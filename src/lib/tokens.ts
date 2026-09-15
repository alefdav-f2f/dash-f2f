import 'server-only';

// Tokens pessoais do conector MCP remoto.
//
// O valor em claro existe uma única vez, no retorno de `createToken`. O banco
// guarda apenas o sha256 — quem tiver acesso ao banco não consegue reconstruir
// um token válido.

import { createHash, randomBytes } from 'node:crypto';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

const PREFIX = 'dashf2f_';

export type TokenRow = {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
};

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Cria um token. O valor em claro só é devolvido aqui, nunca mais. */
export async function createToken(ownerId: string, name: string): Promise<{ token: string; row: TokenRow }> {
  const token = PREFIX + randomBytes(32).toString('base64url');
  const prefix = token.slice(0, PREFIX.length + 6);

  const rows = (await sql`
    INSERT INTO api_tokens (owner_id, name, token_hash, prefix)
    VALUES (${ownerId}, ${name || 'Conector MCP'}, ${hash(token)}, ${prefix})
    RETURNING id, name, prefix, created_at, last_used_at
  `) as TokenRow[];

  return { token, row: rows[0] };
}

export async function listTokens(ownerId: string): Promise<TokenRow[]> {
  return (await sql`
    SELECT id, name, prefix, created_at, last_used_at
      FROM api_tokens
     WHERE owner_id = ${ownerId} AND revoked_at IS NULL
     ORDER BY created_at DESC
  `) as TokenRow[];
}

export async function revokeToken(ownerId: string, tokenId: string): Promise<void> {
  await sql`
    UPDATE api_tokens SET revoked_at = now()
     WHERE id = ${tokenId} AND owner_id = ${ownerId} AND revoked_at IS NULL
  `;
}

/**
 * Valida um token em claro e devolve o dono. Null quando inválido ou revogado.
 * Registra o uso — é o que permite ver no painel se um conector está vivo.
 */
export async function ownerForToken(token: string | null | undefined): Promise<string | null> {
  if (!token || !token.startsWith(PREFIX)) return null;

  const rows = (await sql`
    UPDATE api_tokens SET last_used_at = now()
     WHERE token_hash = ${hash(token)} AND revoked_at IS NULL
     RETURNING owner_id
  `) as Array<{ owner_id: string }>;

  return rows[0]?.owner_id ?? null;
}
