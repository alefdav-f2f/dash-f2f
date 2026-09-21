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
import { InventoryTabs } from '@/components/InventoryTabs';
import { ChangeLog } from '@/components/ChangeLog';
import { LoadingState, ErrorState, EmptyState } from '@/components/States';
import { ApiError, fetchPlugins } from '@/lib/client-api';
import { computeStats, type FilterKey } from '@/lib/plugins';
import { changesByFile, type Change } from '@/lib/diff';
import { displayUrl } from '@/lib/site-url';
import type { ApiErrorKind, ContentActivity, HealthCheck, InventoryResource, Plugin, Theme, WpSettings, WpUser } from '@/lib/types';

type View =
  | { status: 'idle' }
  | { status: 'loading'; site: string }
  | {
      status: 'ok';
      site: string;
      plugins: Plugin[];
      themes: Theme[];
      users: WpUser[];
      settings: WpSettings | null;
      health: HealthCheck[];
      content: ContentActivity[];
      /** Recursos que não puderam ser lidos nesta varredura, com o motivo. */
      failures: Partial<Record<InventoryResource, string>>;
      fetchedAt: number;
      changes: Change[];
      resourceChanges: Change[];
      previousScanAt: string | null;
    }
  | {
      status: 'error';
      site: string;
      kind: ApiErrorKind;
      message: string;
      credentialLastVerifiedAt?: string | null;
    };

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
        themes: data.themes,
        users: data.users,
        settings: data.settings,
        health: data.health,
        content: data.content,
        failures: data.failures,
        fetchedAt: Date.parse(data.fetchedAt),
        changes: data.changes,
        resourceChanges: data.resourceChanges,
        previousScanAt: data.previousScanAt,
      });
      setFreshOutdated((prev) => ({ ...prev, [site]: computeStats(data.plugins).outdated }));
    } catch (err) {
      if (controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return;
      const apiErr = err instanceof ApiError ? err : new ApiError('network', 'Erro inesperado ao consultar o site.');
      setView({
        status: 'error',
        site,
        kind: apiErr.kind,
        message: apiErr.message,
        credentialLastVerifiedAt: apiErr.credentialLastVerifiedAt,
      });
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
            O painel só faz <span className="mono">GET</span> na<br />
            REST API nativa do WordPress.<br />
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

          {view.status === 'ok' && <StatsRow plugins={view.plugins} themes={view.themes} />}
          {view.status === 'ok' && <HealthCritical health={view.health} />}

          {view.status === 'ok' && (
            <ChangeLog
              changes={view.changes}
              resourceChanges={view.resourceChanges}
              previousScanAt={view.previousScanAt}
            />
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
          {view.status === 'error' && (
            <ErrorState
              kind={view.kind}
              message={view.message}
              credentialLastVerifiedAt={view.credentialLastVerifiedAt}
            />
          )}

          {view.status === 'ok' && (
            // As quatro abas ficam sempre visíveis, mesmo com zero plugins: um
            // site recém-instalado pode não ter plugin nenhum e ainda assim
            // ter temas e usuários que valem a pena ver. PluginTable já trata
            // lista vazia com sua própria linha "Nenhum plugin neste filtro" —
            // não precisa de um EmptyState de página inteira bloqueando as
            // outras abas.
            <InventoryTabs
              plugins={view.plugins}
              themes={view.themes}
              users={view.users}
              settings={view.settings}
              health={view.health}
              content={view.content}
              failures={view.failures}
              filter={filter}
              onFilter={setFilter}
              changes={changeIndex}
            />
          )}
        </main>
      </div>
    </>
  );
}

/** Um site que responde a tudo mas não se atualiza sozinho está quebrado de
 *  um jeito que a contagem de plugins não mostra. Uma linha só, perto das
 *  métricas — não um banner — e só aparece quando há de fato uma checagem
 *  'critical'; --red é o único lugar do app fora do próprio badge que usa
 *  essa cor, e é por isso: crítico é a única coisa que precisa gritar. */
function HealthCritical({ health }: { health: HealthCheck[] }) {
  const critical = health.filter((h) => h.status === 'critical').length;
  if (critical === 0) return null;

  return (
    <p className="health-critical">
      {critical} {critical === 1 ? 'checagem de saúde crítica' : 'checagens de saúde críticas'} — veja a aba Saúde.
    </p>
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
