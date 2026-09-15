'use client';

// "O que mudou desde a varredura anterior" — o valor que só existe porque
// agora há histórico no Postgres.

import { CHANGE_LABEL, type Change } from '@/lib/diff';

type Props = {
  changes: Change[];
  previousScanAt: string | null;
};

export function ChangeLog({ changes, previousScanAt }: Props) {
  if (!previousScanAt) {
    return (
      <p className="changelog-none">
        Primeira varredura deste site — o comparativo aparece a partir da próxima.
      </p>
    );
  }

  const since = new Date(previousScanAt).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });

  if (changes.length === 0) {
    return <p className="changelog-none">Nada mudou desde a varredura de {since}.</p>;
  }

  return (
    <div className="changelog">
      <div className="changelog-head">
        <span className="eyebrow">Mudou desde {since}</span>
        <span className="count">{changes.length} {changes.length === 1 ? 'mudança' : 'mudanças'}</span>
      </div>
      <ul className="changelog-list">
        {changes.slice(0, MAX_VISIBLE).map((c, i) => (
          <li key={`${c.file}-${c.kind}-${i}`}>
            <span className={`chg chg-${c.kind}`}>{CHANGE_LABEL[c.kind]}</span>
            <span className="chg-name">{c.name}</span>
            {c.from && c.to && <span className="chg-ver mono">{c.from} → {c.to}</span>}
            {c.from && !c.to && <span className="chg-ver mono">{c.from}</span>}
          </li>
        ))}
        {changes.length > MAX_VISIBLE && (
          <li className="changelog-more">
            + {changes.length - MAX_VISIBLE}{' '}
            {changes.length - MAX_VISIBLE === 1 ? 'mudança marcada' : 'mudanças marcadas'} na tabela abaixo
          </li>
        )}
      </ul>
    </div>
  );
}

/** Acima disso o changelog vira ruído; o resto fica marcado na tabela. */
const MAX_VISIBLE = 5;
