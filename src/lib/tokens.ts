import 'server-only';

// Tokens pessoais do conector MCP remoto.
//
// O valor em claro existe uma única vez, no retorno de `createToken`. O banco
// guarda apenas o sha256 — quem tiver acesso ao banco não consegue reconstruir
// um token válido.

import { createHash, randomBytes } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { isAllowedEmail } from './allowed-email';

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

export type TokenOwner = { ownerId: string; email: string };

/**
 * Valida um token em claro e devolve o dono (id + e-mail). Null quando
 * inválido, revogado, OU quando o dono não está num domínio permitido.
 *
 * Esse terceiro caso é o que muda com sites compartilhados: hoje um token
 * válido lê o inventário inteiro da equipe, não só o de quem o criou. Se a
 * conta que criou o token saiu do domínio permitido (ex.: e-mail cadastrado
 * antes de ALLOWED_EMAIL_DOMAINS existir, ou domínio removido depois), o
 * token não pode continuar sendo uma porta aberta para os dados de todo
 * mundo — mesmo que já não consiga mais logar no painel pela sessão. Por
 * isso o token precisa ser revalidado contra o domínio a cada uso, não só na
 * criação.
 *
 * `isAllowedEmail` é JS, não SQL — por isso o join com `app_users` para
 * trazer o e-mail e checar em código, em vez de tentar expressar a regra de
 * domínio na query.
 *
 * `last_used_at` só é atualizado quando o token resolve para um dono válido
 * e permitido. Um token de conta fora do domínio some do mesmo jeito que um
 * token revogado: se ele também bumpasse `last_used_at`, o painel mostraria
 * esse conector como "vivo" mesmo estando efetivamente inoperante — o mesmo
 * problema que faria alguém confiar num sinal que não significa mais nada.
 */
export async function ownerForToken(token: string | null | undefined): Promise<TokenOwner | null> {
  if (!token || !token.startsWith(PREFIX)) return null;

  const tokenHash = hash(token);
  const rows = (await sql`
    SELECT t.owner_id, u.email
      FROM api_tokens t
      JOIN app_users u ON u.id = t.owner_id
     WHERE t.token_hash = ${tokenHash} AND t.revoked_at IS NULL
  `) as Array<{ owner_id: string; email: string }>;

  const row = rows[0];
  if (!row || !isAllowedEmail(row.email)) return null;

  await sql`UPDATE api_tokens SET last_used_at = now() WHERE token_hash = ${tokenHash}`;

  return { ownerId: row.owner_id, email: row.email };
}
