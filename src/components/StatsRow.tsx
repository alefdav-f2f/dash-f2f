'use client';

// Quatro métricas do site consultado.
// Números sem zero à esquerda — regra do design system v3.

import { computeStats } from '@/lib/plugins';
import type { Plugin } from '@/lib/types';

export function StatsRow({ plugins }: { plugins: Plugin[] }) {
  const s = computeStats(plugins);
  const pct = s.total > 0 ? Math.round((s.active / s.total) * 100) : 0;

  return (
    <div className="stats">
      <div className="stat"><b>{s.total}</b><span className="eyebrow">Plugins</span></div>
      <div className="stat ok"><b>{s.active}</b><span className="eyebrow">Ativos · {pct}% do total</span></div>
      <div className="stat hot"><b>{s.outdated}</b><span className="eyebrow">Com atualização pendente</span></div>
      <div className="stat"><b>{s.inactive}</b><span className="eyebrow">Inativos</span></div>
    </div>
  );
}
