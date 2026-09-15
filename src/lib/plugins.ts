// Regras de domínio: status do plugin, filtros e métricas. Puro e testável.

import type { Plugin, PluginStatusKey } from './types';

export type StatusInfo = { key: PluginStatusKey; label: string; className: string };

/** Os 4 estados canônicos derivados de is_active + has_update. */
export function pluginStatus(p: Plugin): StatusInfo {
  if (p.is_active && p.has_update)
    return { key: 'active-outdated', label: 'Ativo (desatualizado)', className: 'badge-active-outdated' };
  if (p.is_active)
    return { key: 'active', label: 'Ativo', className: 'badge-active' };
  if (p.has_update)
    return { key: 'inactive-outdated', label: 'Inativo (desatualizado)', className: 'badge-inactive-outdated' };
  return { key: 'inactive', label: 'Inativo', className: 'badge-inactive' };
}

export type FilterKey = 'all' | 'outdated' | 'active' | 'inactive';

export const FILTERS: Record<FilterKey, { label: string; test: (p: Plugin) => boolean }> = {
  all: { label: 'Todos', test: () => true },
  outdated: { label: 'Desatualizados', test: (p) => p.has_update },
  active: { label: 'Ativos', test: (p) => p.is_active },
  inactive: { label: 'Inativos', test: (p) => !p.is_active },
};

export type Stats = { total: number; active: number; outdated: number; inactive: number };

export function computeStats(plugins: Plugin[]): Stats {
  return {
    total: plugins.length,
    active: plugins.filter((p) => p.is_active).length,
    outdated: plugins.filter((p) => p.has_update).length,
    inactive: plugins.filter((p) => !p.is_active).length,
  };
}

export const pad2 = (n: number) => String(n).padStart(2, '0');
