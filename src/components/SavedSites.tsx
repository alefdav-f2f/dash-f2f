'use client';

// Lista clicável dos sites da equipe (vinda do Postgres). Clicar reconsulta;
// o "×" remove o site e o histórico dele PARA TODA A EQUIPE (com confirmação) —
// nada é tocado no WordPress.

import { displayUrl } from '@/lib/site-url';
import type { CredentialInfo } from '@/lib/types';

export type SiteSummary = {
  id: string;
  url: string;
  lastFetchedAt: string | null;
  lastOk: boolean | null;
  lastOutdated: number | null;
  lastErrorKind: string | null;
  /** Quem adicionou o site (nome ou e-mail). null = desconhecido — nunca inventar um nome aqui. */
  addedBy: string | null;
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

/** Confirmação nativa — a ação é destrutiva e agora afeta toda a equipe, não só quem clica. */
function confirmRemoval(site: SiteSummary): boolean {
  return window.confirm(
    `Remover ${displayUrl(site.url)} para toda a equipe?\n\n` +
      'Isso apaga o site, todo o histórico de varreduras e a credencial salva — para todos na equipe, não só para você. ' +
      'O WordPress em si não é alterado.\n\nEsta ação não pode ser desfeita.',
  );
}

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
                  title={[
                    site.lastFetchedAt
                      ? `Última varredura: ${new Date(site.lastFetchedAt).toLocaleString('pt-BR')}`
                      : 'Nunca consultado',
                    site.addedBy ? `adicionado por ${site.addedBy}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                >
                  <span className="dot" />
                  <span className="u">{displayUrl(site.url)}</span>
                  <span className="n">{failing ? '!' : (outdated ?? '·')}</span>
                </button>
                <button
                  type="button"
                  className="x"
                  aria-label={`Remover ${displayUrl(site.url)} da lista`}
                  title="Remover para toda a equipe (apaga o histórico e a credencial deste site)"
                  onClick={() => {
                    if (confirmRemoval(site)) onRemove(site);
                  }}
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
