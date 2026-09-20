'use client';

// Lista clicável de sites do usuário (vinda do Postgres). Clicar reconsulta;
// o "×" remove o site e o histórico dele — nada é tocado no WordPress.

import { displayUrl } from '@/lib/site-url';
import type { CredentialInfo } from '@/lib/types';

export type SiteSummary = {
  id: string;
  url: string;
  lastFetchedAt: string | null;
  lastOk: boolean | null;
  lastOutdated: number | null;
  lastErrorKind: string | null;
  /** null = nenhuma Application Password cadastrada para este site ainda. */
  credential: CredentialInfo | null;
};

type Props = {
  sites: SiteSummary[];
  current: string | null;
  /** Contagem fresca desta sessão, sobrepõe o resumo do banco. */
  freshOutdated: Record<string, number>;
  onSelect: (url: string) => void;
  onRemove: (site: SiteSummary) => void;
};

export function SavedSites({ sites, current, freshOutdated, onSelect, onRemove }: Props) {
  return (
    <div>
      <div className="eyebrow list-head">
        <span>Sites salvos · {sites.length}</span>
        <span className="list-head-hint">pendências</span>
      </div>

      {sites.length === 0 ? (
        <p className="sites-empty">Nenhum site salvo ainda.</p>
      ) : (
        <div className="sites">
          {sites.map((site) => {
            const outdated = freshOutdated[site.url] ?? site.lastOutdated;
            const failing = site.lastOk === false;
            const classes = [
              'site',
              site.url === current ? 'on' : '',
              outdated && outdated > 0 ? 'warn' : '',
              failing ? 'failing' : '',
            ]
              .filter(Boolean)
              .join(' ');

            return (
              <div className={classes} key={site.id}>
                <button
                  type="button"
                  className="site-open"
                  onClick={() => onSelect(site.url)}
                  title={site.lastFetchedAt ? `Última varredura: ${new Date(site.lastFetchedAt).toLocaleString('pt-BR')}` : 'Nunca consultado'}
                >
                  <span className="dot" />
                  <span className="u">{displayUrl(site.url)}</span>
                  <span className="n">{failing ? '!' : (outdated ?? '·')}</span>
                </button>
                <button
                  type="button"
                  className="x"
                  aria-label={`Remover ${displayUrl(site.url)} da lista`}
                  title="Remover da lista (apaga o histórico deste site)"
                  onClick={() => onRemove(site)}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
