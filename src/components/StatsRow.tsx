'use client';

// Quatro métricas do site consultado.

import { computeStats, pad2 } from '@/lib/plugins';
import type { Plugin } from '@/lib/types';

export function StatsRow({ plugins }: { plugins: Plugin[] }) {
  const s = computeStats(plugins);
  return (
    <div className="stats">
      <div className="stat"><b>{pad2(s.total)}</b><span className="eyebrow">Plugins</span></div>
      <div className="stat ok"><b>{pad2(s.active)}</b><span className="eyebrow">Ativos</span></div>
      <div className="stat hot"><b>{pad2(s.outdated)}</b><span className="eyebrow">Desatualizados</span></div>
      <div className="stat"><b>{pad2(s.inactive)}</b><span className="eyebrow">Inativos</span></div>
    </div>
  );
}
