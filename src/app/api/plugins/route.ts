// Consulta um site do usuário logado, grava a varredura e devolve o snapshot
// junto com o diff contra a varredura anterior.
//
// CONTRATO: só GET sai daqui para o WordPress (ver src/lib/wp-rest.ts, que é o
// único ponto de saída). A credencial usada TEM poder de escrita no WordPress —
// Application Password não tem escopo no core — então a garantia de somente
// leitura é imposta por aquele módulo, não pela credencial. A escrita acontece
// apenas no nosso Postgres.

import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import {
  findSite,
  recentScans,
  saveInventoryExtras,
  saveScan,
  scanPlugins,
  scanSettings,
  scanThemes,
  scanUsers,
} from '@/lib/db';
import { diffScans, diffSettings, diffThemes, diffUsers } from '@/lib/diff';
import { InvalidSiteUrlError, normalizeSiteUrl } from '@/lib/site-url';
import { collectInventory, WpError } from '@/lib/wp-rest';
import { credentialStatus, getCredential, markCredentialResult } from '@/lib/credentials';
import { SecretPayloadError } from '@/lib/crypto';
import type { ApiErrorKind, ApiErrorPayload } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fail(
  status: number,
  kind: ApiErrorKind,
  message: string,
  detail?: string,
  credentialLastVerifiedAt?: string | null,
) {
  const body: ApiErrorPayload = {
    error: true,
    kind,
    message,
    ...(detail ? { detail } : {}),
    // undefined = campo omitido de propósito (sinal indisponível); ver types.ts.
    ...(credentialLastVerifiedAt !== undefined ? { credentialLastVerifiedAt } : {}),
  };
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

  // Sites são compartilhados pela equipe — só precisa existir.
  const row = await findSite(site);
  if (!row) return fail(404, 'not_found', 'Este site não está cadastrado.');

  // Varredura anterior (para o diff) antes de gravar a nova. Varredura que
  // falhou não deixou snapshot nenhum — nada a comparar, então as quatro
  // listas ficam vazias e os diffs correspondentes saem vazios também.
  const [previousScan] = await recentScans(row.id, 1);
  const [previousPlugins, previousThemes, previousUsers, previousSettings] = previousScan?.ok
    ? await Promise.all([
        scanPlugins(previousScan.id),
        scanThemes(previousScan.id),
        scanUsers(previousScan.id),
        scanSettings(previousScan.id),
      ])
    : [[], [], [], null];

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

    // Só no 401 a UI precisa do histórico da credencial para ordenar hipóteses
    // de causa (ver src/components/States.tsx). Consulta extra só neste
    // caminho de erro — o caminho feliz não paga por ela.
    let credentialLastVerifiedAt: string | null | undefined;
    if (wpErr.kind === 'unauthorized') {
      const status = await credentialStatus(row.id);
      credentialLastVerifiedAt = status?.last_verified_at ?? null;
    }

    return fail(wpErr.status, wpErr.kind, wpErr.message, wpErr.detail, credentialLastVerifiedAt);
  }

  const { plugins, themes, users, settings, health, failures } = inventory;

  const scanId = await saveScan({ siteId: row.id, source: 'manual', plugins });
  await saveInventoryExtras(scanId, { themes, users, settings, health });

  return NextResponse.json(
    {
      site,
      scanId,
      fetchedAt: new Date().toISOString(),
      plugins,
      themes,
      users,
      settings,
      health,
      failures,
      changes: diffScans(plugins, previousPlugins),
      // Usuário, tema e settings compartilham um `Change` só (ver src/lib/diff.ts):
      // a Task 11 agrupa por `resource` para renderizar, então uma lista combinada
      // evita que a UI tenha que voltar a separar o que já vem junto. Fica de fora
      // de `changes` de propósito — aquele campo é indexado por file de plugin em
      // PluginTable, e misturar chaveria por id numérico de usuário/stylesheet de
      // tema junto com file de plugin arrisca colisão e marcaria a linha errada.
      resourceChanges: [
        ...diffUsers(users, previousUsers),
        ...diffThemes(themes, previousThemes),
        ...diffSettings(settings, previousSettings),
      ],
      previousScanAt: previousScan?.fetched_at ?? null,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
