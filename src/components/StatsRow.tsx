'use client';

// Quatro métricas do site consultado.
// Números sem zero à esquerda — regra do design system v3.
//
// As quatro métricas continuam plugin-only, de propósito: `scans.outdated`
// (o que fica gravado no histórico e alimenta o sparkline) só soma plugins —
// ver stats() em src/lib/db.ts. Se "Com atualização pendente" passasse a
// somar temas também, a tela discordaria do que a própria tabela `scans`
// registra para esse mesmo instante. Por isso o rótulo agora diz "Plugins
// com atualização pendente", explícito sobre o que conta, e temas
// desatualizados ganham uma linha própria abaixo — mesmo tratamento que a
// cobertura de update_source 'unknown' já recebe.

import { computeStats } from '@/lib/plugins';
import type { Plugin, Theme } from '@/lib/types';

export function StatsRow({ plugins, themes }: { plugins: Plugin[]; themes: Theme[] }) {
  const s = computeStats(plugins);
  const pct = s.total > 0 ? Math.round((s.active / s.total) * 100) : 0;
  const unknown = plugins.filter((p) => p.update_source === 'unknown').length;
  const themesOutdated = themes.filter((t) => t.has_update).length;

  return (
    <>
      <div className="stats">
        <div className="stat"><b>{s.total}</b><span className="eyebrow">Plugins</span></div>
        <div className="stat ok"><b>{s.active}</b><span className="eyebrow">Ativos · {pct}% do total</span></div>
        <div className="stat hot"><b>{s.outdated}</b><span className="eyebrow">Plugins com atualização pendente</span></div>
        <div className="stat"><b>{s.inactive}</b><span className="eyebrow">Inativos</span></div>
      </div>
      {unknown > 0 && (
        <p className="coverage">
          {unknown} {unknown === 1 ? 'plugin não está' : 'plugins não estão'} no repositório oficial
          do WordPress — para {unknown === 1 ? 'ele' : 'eles'}, não é possível saber se há atualização.
        </p>
      )}
      {themesOutdated > 0 && (
        <p className="coverage">
          {themesOutdated} {themesOutdated === 1 ? 'tema tem' : 'temas têm'} atualização pendente — veja a aba Temas.
        </p>
      )}
    </>
  );
}
