import 'server-only';

// Credencial de leitura por site. A senha entra em claro aqui e sai cifrada
// para o banco; o caminho inverso só acontece no momento da varredura.
//
// Toda função exige ownerId: a posse do site é verificada no SQL, nunca antes.

import { neon } from '@neondatabase/serverless';
import { decryptSecret, encryptSecret } from './crypto';

const sql = neon(process.env.DATABASE_URL!);

export type CredentialStatus = {
  wp_user: string;
  created_at: string;
  last_verified_at: string | null;
  last_error: string | null;
};

/** Grava ou substitui a credencial. A senha em claro não sobrevive a esta função. */
export async function saveCredential(
  ownerId: string,
  siteId: string,
  wpUser: string,
  appPassword: string,
): Promise<void> {
  const cipher = encryptSecret(appPassword);
  const rows = (await sql`
    INSERT INTO site_credentials (site_id, wp_user, password_cipher)
    SELECT ${siteId}, ${wpUser}, ${cipher}
      FROM sites WHERE id = ${siteId} AND owner_id = ${ownerId}
    ON CONFLICT (site_id) DO UPDATE
       SET wp_user = EXCLUDED.wp_user,
           password_cipher = EXCLUDED.password_cipher,
           updated_at = now(),
           last_error = NULL
    RETURNING site_id
  `) as Array<{ site_id: string }>;

  if (rows.length === 0) throw new Error('Site não encontrado nesta conta.');
}

/**
 * Credencial decifrada, para uso imediato na varredura. Null quando não há.
 *
 * Não recebe ownerId de propósito: quem chama (o caminho de varredura) já
 * resolveu o site via `findSite(ownerId, url)` em `db.ts`, então a posse já
 * foi estabelecida antes desta função ser chamada — não é um descuido.
 *
 * Pode propagar dois erros de `crypto.ts`, e quem chamar NÃO deve capturá-los
 * nem misturá-los num catch genérico:
 * - `CredentialsKeyError`: CREDENTIALS_KEY ausente/inválida — falha de
 *   configuração do servidor, afeta todos os sites.
 * - `SecretPayloadError`: ciphertext daquele site específico não decifra —
 *   problema pontual, o dono precisa reinserir a credencial.
 */
export async function getCredential(
  siteId: string,
): Promise<{ user: string; password: string } | null> {
  const rows = (await sql`
    SELECT wp_user, password_cipher FROM site_credentials WHERE site_id = ${siteId}
  `) as Array<{ wp_user: string; password_cipher: string }>;

  if (rows.length === 0) return null;
  return { user: rows[0].wp_user, password: decryptSecret(rows[0].password_cipher) };
}

/** Status para a UI — nunca devolve a senha, nem cifrada. */
export async function credentialStatus(
  ownerId: string,
  siteId: string,
): Promise<CredentialStatus | null> {
  const rows = (await sql`
    SELECT c.wp_user, c.created_at, c.last_verified_at, c.last_error
      FROM site_credentials c
      JOIN sites s ON s.id = c.site_id
     WHERE c.site_id = ${siteId} AND s.owner_id = ${ownerId}
  `) as CredentialStatus[];
  return rows[0] ?? null;
}

/**
 * Status de todas as credenciais do dono, numa única consulta — evita N+1 ao
 * montar a lista de sites na página inicial (um `credentialStatus` por site
 * faria uma query por site).
 */
export async function listCredentialStatuses(
  ownerId: string,
): Promise<Map<string, CredentialStatus>> {
  const rows = (await sql`
    SELECT c.site_id, c.wp_user, c.created_at, c.last_verified_at, c.last_error
      FROM site_credentials c
      JOIN sites s ON s.id = c.site_id
     WHERE s.owner_id = ${ownerId}
  `) as Array<CredentialStatus & { site_id: string }>;

  return new Map(rows.map((r) => [r.site_id, r]));
}

export async function deleteCredential(ownerId: string, siteId: string): Promise<void> {
  await sql`
    DELETE FROM site_credentials
     WHERE site_id = ${siteId}
       AND site_id IN (SELECT id FROM sites WHERE owner_id = ${ownerId})
  `;
}

/** Registra o resultado da última tentativa de uso. */
export async function markCredentialResult(siteId: string, error: string | null): Promise<void> {
  await sql`
    UPDATE site_credentials
       SET last_error = ${error},
           last_verified_at = CASE WHEN ${error}::text IS NULL THEN now() ELSE last_verified_at END
     WHERE site_id = ${siteId}
  `;
}
