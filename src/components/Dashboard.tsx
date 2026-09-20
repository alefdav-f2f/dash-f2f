'use client';

// Dashboard interativo: dispara consultas, troca de site e aplica filtros.
// Os sites vêm do servidor (Postgres); add/remove passam por Server Actions.

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { addSiteAction, removeSiteAction, signOutAction } from '@/app/actions';
import { SiteForm } from '@/components/SiteForm';
import { SavedSites, type SiteSummary } from '@/components/SavedSites';
import { CredentialForm } from '@/components/CredentialForm';
import { StatsRow } from '@/components/StatsRow';
import { PluginTable } from '@/components/PluginTable';
import { ChangeLog } from '@/components/ChangeLog';
import { LoadingState, ErrorState, EmptyState } from '@/components/States';
import { ApiError, fetchPlugins } from '@/lib/client-api';
import { computeStats, type FilterKey } from '@/lib/plugins';
import { changesByFile, type Change } from '@/lib/diff';
import { displayUrl } from '@/lib/site-url';
import type { ApiErrorKind, Plugin } from '@/lib/types';

type View =
  | { status: 'idle' }
  | { status: 'loading'; site: string }
  | { status: 'ok'; site: string; plugins: Plugin[]; fetchedAt: number; changes: Change[]; previousScanAt: string | null }
  | { status: 'error'; site: string; kind: ApiErrorKind; message: string };

type Props = {
  sites: SiteSummary[];
  user: { name: string; email: string };
};

export function Dashboard({ sites, user }: Props) {
  const [view, setView] = useState<View>({ status: 'idle' });
  const [filter, setFilter] = useState<FilterKey>('all');
  /** Contadores frescos desta sessão sobrepõem o resumo vindo do banco. */
  const [freshOutdated, setFreshOutdated] = useState<Record<string, number>>({});
  const inFlight = useRef<AbortController | null>(null);
  const [pending, startTransition] = useTransition();

  const query = useCallback(async (site: string) => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    setFilter('all');
    setView({ status: 'loading', site });

    try {
      const data = await fetchPlugins(site, controller.signal);
      if (controller.signal.aborted) return;
      setView({
        status: 'ok',
        site,
        plugins: data.plugins,
        fetchedAt: Date.parse(data.fetchedAt),
        changes: data.changes,
        previousScanAt: data.previousScanAt,
      });
      setFreshOutdated((prev) => ({ ...prev, [site]: computeStats(data.plugins).outdated }));
    } catch (err) {
      if (controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return;
      const apiErr = err instanceof ApiError ? err : new ApiError('network', 'Erro inesperado ao consultar o site.');
      setView({ status: 'error', site, kind: apiErr.kind, message: apiErr.message });
    }
  }, []);

  // Abre já mostrando o primeiro site da lista.
  useEffect(() => {
    if (sites.length > 0 && view.status === 'idle') void query(sites[0].url);
  }, [sites, view.status, query]);

  function handleAdd(rawUrl: string) {
    startTransition(async () => {
      const result = await addSiteAction(rawUrl);
      if (result.ok) await query(result.url);
    });
  }

  function handleRemove(site: SiteSummary) {
    startTransition(async () => {
      await removeSiteAction(site.id);
      if (view.status !== 'idle' && view.site === site.url) setView({ status: 'idle' });
    });
  }

  const currentSite = view.status === 'idle' ? null : view.site;
  const changeIndex = view.status === 'ok' ? changesByFile(view.changes) : {};
  const currentSiteSummary = currentSite ? sites.find((s) => s.url === currentSite) ?? null : null;

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="mark">F2</span>
          <h1>dash-f2f</h1>
          <span className="brand-sub">monitor de plugins WordPress</span>
        </div>
        <div className="topbar-right">
          <span className="ro"><i /> somente leitura</span>
          <Link className="ghost" href="/conectores">Conector MCP</Link>
          <form action={signOutAction}>
            <button className="ghost" type="submit" title={user.email}>
              <span className="user-name">{user.name} · </span>sair
            </button>
          </form>
        </div>
      </header>

      <div className="shell">
        <aside className="side">
          <SiteForm onSubmit={handleAdd} busy={view.status === 'loading' || pending} />

          <SavedSites
            sites={sites}
            current={currentSite}
            freshOutdated={freshOutdated}
            onSelect={(url) => void query(url)}
            onRemove={handleRemove}
          />

          {currentSiteSummary && (
            <CredentialForm
              key={currentSiteSummary.id}
              siteId={currentSiteSummary.id}
              siteUrl={currentSiteSummary.url}
              current={currentSiteSummary.credential}
            />
          )}

          <footer className="side-foot">
            O painel só faz <span className="mono">GET</span> em<br />
            <span className="mono">/wp-json/site-status/v1/plugins</span>.<br />
            Nenhuma escrita no WordPress.
          </footer>
        </aside>

        <main className="main">
          <div className="mhead">
            <div>
              <div className="eyebrow">Consultando</div>
              <div className="url">{currentSite ? displayUrl(currentSite) : '—'}</div>
            </div>
            <div className="mhead-right">
              {view.status === 'ok' && <RelativeTime timestamp={view.fetchedAt} />}
              <button
                className="ghost"
                type="button"
                disabled={!currentSite || view.status === 'loading'}
                onClick={() => currentSite && void query(currentSite)}
              >
                Recarregar
              </button>
            </div>
          </div>

          {view.status === 'ok' && <StatsRow plugins={view.plugins} />}

          {view.status === 'ok' && (
            <ChangeLog changes={view.changes} previousScanAt={view.previousScanAt} />
          )}

          {view.status === 'idle' && (
            <EmptyState
              title={sites.length ? 'Escolha um site' : 'Nenhum site monitorado'}
              body={
                sites.length
                  ? 'Clique em um site da lista para ver o inventário de plugins dele.'
                  : 'Adicione a URL de um site WordPress para ver o inventário de plugins dele.'
              }
              onCta={sites.length ? undefined : () => document.getElementById('site-input')?.focus()}
            />
          )}

          {view.status === 'loading' && <LoadingState site={view.site} />}
          {view.status === 'error' && <ErrorState kind={view.kind} message={view.message} />}

          {view.status === 'ok' &&
            (view.plugins.length === 0 ? (
              <EmptyState
                title="Nenhum plugin instalado neste site"
                body="O endpoint respondeu com uma lista vazia."
              />
            ) : (
              <PluginTable
                plugins={view.plugins}
                filter={filter}
                onFilter={setFilter}
                changes={changeIndex}
              />
            ))}
        </main>
      </div>
    </>
  );
}

/** "atualizado há 2 min" — só no cliente, evita divergência de hidratação. */
function RelativeTime({ timestamp }: { timestamp: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  const label =
    seconds < 45 ? 'agora mesmo' : seconds < 3600 ? `há ${Math.round(seconds / 60)} min` : `há ${Math.round(seconds / 3600)} h`;

  return <span className="when">atualizado {label}</span>;
}
