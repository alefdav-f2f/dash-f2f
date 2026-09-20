'use client';

// Quatro métricas do site consultado.
// Números sem zero à esquerda — regra do design system v3.

import { computeStats } from '@/lib/plugins';
import type { Plugin } from '@/lib/types';

export function StatsRow({ plugins }: { plugins: Plugin[] }) {
  const s = computeStats(plugins);
  const pct = s.total > 0 ? Math.round((s.active / s.total) * 100) : 0;
  const unknown = plugins.filter((p) => p.update_source === 'unknown').length;

  return (
    <>
      <div className="stats">
        <div className="stat"><b>{s.total}</b><span className="eyebrow">Plugins</span></div>
        <div className="stat ok"><b>{s.active}</b><span className="eyebrow">Ativos · {pct}% do total</span></div>
        <div className="stat hot"><b>{s.outdated}</b><span className="eyebrow">Com atualização pendente</span></div>
        <div className="stat"><b>{s.inactive}</b><span className="eyebrow">Inativos</span></div>
      </div>
      {unknown > 0 && (
        <p className="coverage">
          {unknown} {unknown === 1 ? 'plugin não está' : 'plugins não estão'} no repositório oficial
          do WordPress — para {unknown === 1 ? 'ele' : 'eles'}, não é possível saber se há atualização.
        </p>
      )}
    </>
  );
}
