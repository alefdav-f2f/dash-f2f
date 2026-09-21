'use server';

// Server Actions da lista de sites. Escrita só no nosso Postgres — nada é
// enviado ao WordPress.

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth, requireUser } from '@/lib/auth';
import { addSite, removeSite } from '@/lib/db';
import { deleteCredential, saveCredential } from '@/lib/credentials';
import { createToken, revokeToken } from '@/lib/tokens';
import { InvalidSiteUrlError, normalizeSiteUrl } from '@/lib/site-url';

export type ActionResult = { ok: true; url: string } | { ok: false; error: string };

export async function addSiteAction(rawUrl: string): Promise<ActionResult> {
  const user = await requireUser();

  let url: string;
  try {
    url = normalizeSiteUrl(rawUrl);
  } catch (err) {
    return { ok: false, error: err instanceof InvalidSiteUrlError ? err.message : 'URL inválida.' };
  }

  await addSite(user.id, url);
  revalidatePath('/');
  return { ok: true, url };
}

export async function removeSiteAction(siteId: string): Promise<void> {
  await requireUser();
  await removeSite(siteId);
  revalidatePath('/');
}

/* ── conector MCP ──────────────────────────────────────────────────────── */

/** Cria um token. O valor em claro volta uma única vez, para ser copiado. */
export async function createTokenAction(name: string): Promise<{ token: string }> {
  const user = await requireUser();
  const { token } = await createToken(user.id, name.trim().slice(0, 60));
  revalidatePath('/conectores');
  return { token };
}

export async function revokeTokenAction(tokenId: string): Promise<void> {
  const user = await requireUser();
  await revokeToken(user.id, tokenId);
  revalidatePath('/conectores');
}

export async function signOutAction(): Promise<void> {
  await auth.signOut();
  redirect('/auth/sign-in');
}

/* ── credenciais de site ───────────────────────────────────────────────── */

/**
 * `ActionResult` carrega `url` porque o add-site flow precisa devolver a URL
 * normalizada para a consulta seguinte. Uma credencial não tem equivalente —
 * devolver `{ ok: true, url: '' }` faria o chamador desconfiar de uma string
 * vazia sem significado. Por isso um tipo dedicado, sem campo de sucesso além
 * de `ok`.
 */
export type CredentialActionResult = { ok: true } | { ok: false; error: string };

export async function saveCredentialAction(
  siteId: string,
  wpUser: string,
  appPassword: string,
): Promise<CredentialActionResult> {
  await requireUser();

  const cleanUser = wpUser.trim();
  // O WordPress mostra a Application Password em grupos de 4; aceitar com e sem
  // espaço evita o erro mais comum de colagem.
  const cleanPassword = appPassword.trim();

  if (!cleanUser) return { ok: false, error: 'Informe o usuário do WordPress.' };
  if (cleanPassword.length < 16) return { ok: false, error: 'Application Password parece curta demais.' };

  try {
    await saveCredential(siteId, cleanUser, cleanPassword);
  } catch (err) {
    // saveCredential só lança CredentialsKeyError (texto fixo sobre a env var
    // CREDENTIALS_KEY), o erro "Site não encontrado nesta conta." ou um erro
    // do driver do Postgres — em nenhum desses casos a senha em claro entra
    // na mensagem, porque ela nunca é gravada fora de `password_cipher` (já
    // cifrada). Ainda assim, nunca logar `err` aqui, só repassar `.message`.
    return { ok: false, error: err instanceof Error ? err.message : 'Não foi possível salvar.' };
  }

  revalidatePath('/');
  return { ok: true };
}

export async function deleteCredentialAction(siteId: string): Promise<void> {
  await requireUser();
  await deleteCredential(siteId);
  revalidatePath('/');
}
