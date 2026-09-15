// Varredura diária de todos os sites cadastrados (todos os donos).
// Roda fora de sessão: a autenticação é o CRON_SECRET, que a Vercel envia como
// `Authorization: Bearer <CRON_SECRET>` nas invocações de cron.

import { NextRequest, NextResponse } from 'next/server';
import { listAllSites, saveScan } from '@/lib/db';
import { fetchSitePlugins, WpError } from '@/lib/wp';

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
  const results: Array<{ url: string; ok: boolean; outdated?: number; error?: string }> = [];

  // Fila simples com concorrência limitada: um lote de sites lentos não pode
  // estourar o tempo da função.
  const queue = [...sites];
  async function worker() {
    for (let site = queue.shift(); site; site = queue.shift()) {
      try {
        const plugins = await fetchSitePlugins(site.url);
        await saveScan({ siteId: site.id, source: 'cron', plugins });
        results.push({ url: site.url, ok: true, outdated: plugins.filter((p) => p.has_update).length });
      } catch (err) {
        const wpErr = err instanceof WpError ? err : new WpError('network', 502, 'Erro inesperado.');
        await saveScan({ siteId: site.id, source: 'cron', errorKind: wpErr.kind, errorMessage: wpErr.message });
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
