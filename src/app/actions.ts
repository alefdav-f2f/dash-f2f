'use server';

// Server Actions da lista de sites. Escrita só no nosso Postgres — nada é
// enviado ao WordPress.

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth, requireUser } from '@/lib/auth';
import { addSite, removeSite } from '@/lib/db';
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
  const user = await requireUser();
  await removeSite(user.id, siteId);
  revalidatePath('/');
}

export async function signOutAction(): Promise<void> {
  await auth.signOut();
  redirect('/auth/sign-in');
}
