// Varredura diária de todos os sites cadastrados (todos os donos).
// Roda fora de sessão: a autenticação é o CRON_SECRET, que a Vercel envia como
// `Authorization: Bearer <CRON_SECRET>` nas invocações de cron.

import { NextRequest, NextResponse } from 'next/server';
import { listAllSites, saveInventoryExtras, saveScan } from '@/lib/db';
import { collectInventory, WpError } from '@/lib/wp-rest';
import { getCredential, markCredentialResult } from '@/lib/credentials';
import { SecretPayloadError } from '@/lib/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const CONCURRENCY = 4;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET não configurado.' }, { status: 500 });
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
  }

  const sites = await listAllSites();
  const results: Array<{ url: string; ok: boolean; outdated?: number; failedResources?: number; error?: string }> = [];

  // Fila simples com concorrência limitada: um lote de sites lentos não pode
  // estourar o tempo da função.
  const queue = [...sites];
  async function worker() {
    for (let site = queue.shift(); site; site = queue.shift()) {
      // Credencial ilegível é problema de um site; não pode derrubar a
      // varredura dos outros. Já CredentialsKeyError sobe e aborta o cron
      // inteiro de propósito: sem a chave, nenhum site seria varrido mesmo.
      let credential;
      try {
        credential = await getCredential(site.id);
      } catch (err) {
        if (!(err instanceof SecretPayloadError)) throw err;
        await saveScan({
          siteId: site.id,
          source: 'cron',
          errorKind: 'bad_credential',
          errorMessage: 'Credencial armazenada ilegível.',
        });
        await markCredentialResult(site.id, 'Credencial armazenada ilegível.');
        results.push({ url: site.url, ok: false, error: 'credencial ilegível' });
        continue;
      }

      if (!credential) {
        await saveScan({
          siteId: site.id,
          source: 'cron',
          errorKind: 'no_credential',
          errorMessage: 'Site sem Application Password cadastrada.',
        });
        results.push({ url: site.url, ok: false, error: 'sem credencial' });
        continue;
      }

      try {
        const { plugins, themes, users, settings, health, failures } = await collectInventory(site.url, credential);
        const scanId = await saveScan({ siteId: site.id, source: 'cron', plugins });
        await saveInventoryExtras(scanId, { themes, users, settings, health });
        await markCredentialResult(site.id, null);
        results.push({
          url: site.url,
          ok: true,
          outdated: plugins.filter((p) => p.has_update).length,
          // Best-effort: themes/users/settings podem falhar sem derrubar o
          // scan. Contar aqui deixa o resumo do cron flagrar um site que está
          // perdendo cobertura, sem exigir abrir cada scan para descobrir.
          failedResources: Object.keys(failures).length || undefined,
        });
      } catch (err) {
        const wpErr = err instanceof WpError ? err : new WpError('network', 502, 'Erro inesperado.');
        await saveScan({ siteId: site.id, source: 'cron', errorKind: wpErr.kind, errorMessage: wpErr.message });
        await markCredentialResult(site.id, wpErr.message);
        results.push({ url: site.url, ok: false, error: wpErr.message });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, sites.length) }, worker));

  return NextResponse.json({
    scannedAt: new Date().toISOString(),
    sites: results.length,
    failures: results.filter((r) => !r.ok).length,
    results,
  });
}
