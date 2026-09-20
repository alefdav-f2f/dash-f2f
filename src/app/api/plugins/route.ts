// Consulta um site do usuário logado, grava a varredura e devolve o snapshot
// junto com o diff contra a varredura anterior.
//
// CONTRATO: só GET sai daqui para o WordPress (ver src/lib/wp.ts). A escrita
// acontece apenas no nosso Postgres.

import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { findSite, recentScans, saveInventoryExtras, saveScan, scanPlugins } from '@/lib/db';
import { diffScans } from '@/lib/diff';
import { InvalidSiteUrlError, normalizeSiteUrl } from '@/lib/site-url';
import { collectInventory, WpError } from '@/lib/wp-rest';
import { getCredential, markCredentialResult } from '@/lib/credentials';
import { SecretPayloadError } from '@/lib/crypto';
import type { ApiErrorKind, ApiErrorPayload } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fail(status: number, kind: ApiErrorKind, message: string, detail?: string) {
  const body: ApiErrorPayload = { error: true, kind, message, ...(detail ? { detail } : {}) };
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user) return fail(401, 'http', 'Sessão expirada. Faça login novamente.');

  let site: string;
  try {
    site = normalizeSiteUrl(request.nextUrl.searchParams.get('site') ?? '');
  } catch (err) {
    return fail(400, 'invalid_url', err instanceof InvalidSiteUrlError ? err.message : 'URL inválida.');
  }

  // O site precisa ser do usuário — a lista é a fonte de verdade da posse.
  const row = await findSite(user.id, site);
  if (!row) return fail(404, 'not_found', 'Este site não está na sua lista.');

  // Varredura anterior (para o diff) antes de gravar a nova.
  const [previousScan] = await recentScans(row.id, 1);
  const previousPlugins = previousScan?.ok ? await scanPlugins(previousScan.id) : [];

  // Duas falhas de credencial, duas remediações opostas — não colapse as duas.
  // CredentialsKeyError = CREDENTIALS_KEY ausente/errada: a frota inteira está
  // fora, é problema de ambiente, propaga como 500.
  // SecretPayloadError = o payload daquele site não decifra: problema de um
  // site só, o dono precisa cadastrar a senha de novo.
  let credential;
  try {
    credential = await getCredential(row.id);
  } catch (err) {
    if (err instanceof SecretPayloadError) {
      await markCredentialResult(row.id, 'Credencial armazenada ilegível.');
      return fail(
        400,
        'bad_credential',
        'A credencial gravada para este site não pôde ser lida. Cadastre a Application Password novamente.',
      );
    }
    throw err; // CredentialsKeyError e o resto sobem: é falha de servidor.
  }

  if (!credential) {
    return fail(
      400,
      'no_credential',
      'Este site ainda não tem Application Password cadastrada. Cadastre em Configurações do site.',
    );
  }

  let inventory;
  try {
    inventory = await collectInventory(site, credential);
    await markCredentialResult(row.id, null);
  } catch (err) {
    const wpErr = err instanceof WpError ? err : new WpError('network', 502, 'Erro inesperado ao consultar o site.');
    // O erro também vira histórico: saber quando o site parou de responder importa.
    await saveScan({ siteId: row.id, source: 'manual', errorKind: wpErr.kind, errorMessage: wpErr.message });
    await markCredentialResult(row.id, wpErr.message);
    return fail(wpErr.status, wpErr.kind, wpErr.message, wpErr.detail);
  }

  const { plugins, themes, users, settings, failures } = inventory;

  const scanId = await saveScan({ siteId: row.id, source: 'manual', plugins });
  await saveInventoryExtras(scanId, { themes, users, settings });

  return NextResponse.json(
    {
      site,
      scanId,
      fetchedAt: new Date().toISOString(),
      plugins,
      themes,
      users,
      settings,
      failures,
      changes: diffScans(plugins, previousPlugins),
      previousScanAt: previousScan?.fetched_at ?? null,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
