'use client';

// Tabela de plugins + barra de filtros. Recebe a lista completa e filtra aqui.

import { FILTERS, computeStats, pluginStatus, type FilterKey } from '@/lib/plugins';
import { CHANGE_LABEL, type Change } from '@/lib/diff';
import type { Plugin } from '@/lib/types';

type Props = {
  plugins: Plugin[];
  filter: FilterKey;
  onFilter: (key: FilterKey) => void;
  /** Mudanças desde a varredura anterior, indexadas por `file`. */
  changes?: Record<string, Change[]>;
};

export function PluginTable({ plugins, filter, onFilter, changes = {} }: Props) {
  const stats = computeStats(plugins);
  const countByKey: Record<FilterKey, number> = {
    all: stats.total,
    outdated: stats.outdated,
    active: stats.active,
    inactive: stats.inactive,
  };
  // O que exige ação vem primeiro: pendentes, depois ativos, depois nome.
  const rows = plugins.filter(FILTERS[filter].test).slice().sort((a, b) => {
    if (a.has_update !== b.has_update) return a.has_update ? -1 : 1;
    if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
    return a.name.localeCompare(b.name, 'pt-BR');
  });

  return (
    <div className="tablewrap">
      <div className="tbar">
        <div className="chips">
          {(Object.keys(FILTERS) as FilterKey[]).map((key) => (
            <button
              key={key}
              type="button"
              className={`chip${key === filter ? ' on' : ''}`}
              aria-pressed={key === filter}
              onClick={() => onFilter(key)}
            >
              {FILTERS[key].label} · {countByKey[key]}
            </button>
          ))}
        </div>
        <span className="count">{rows.length} de {stats.total} plugins</span>
      </div>

      <table>
        <thead>
          <tr>
            <th style={{ width: '46%' }}>Plugin</th>
            <th style={{ width: '24%' }}>Versão</th>
            <th style={{ width: '30%' }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={3} className="table-empty">Nenhum plugin neste filtro.</td>
            </tr>
          ) : (
            rows.map((p) => {
              const status = pluginStatus(p);
              const hasNew = p.has_update && Boolean(p.new_version);
              const rowChanges = changes[p.file || p.name] ?? [];
              return (
                <tr key={p.file || p.name} className={rowChanges.length ? 'row-changed' : undefined}>
                  <td data-col="plugin">
                    <div className="pname">
                      {p.name}
                      {rowChanges.map((c, i) => (
                        <span className={`chg chg-${c.kind}`} key={i}>{CHANGE_LABEL[c.kind]}</span>
                      ))}
                    </div>
                    {p.file && <div className="pfile">{p.file}</div>}
                  </td>
                  <td data-col="versao">
                    <span className="ver">{p.version}</span>
                    {hasNew && <span className="new">{p.new_version}</span>}
                  </td>
                  <td data-col="status">
                    <span className={`badge ${status.className}`}>{status.label}</span>
                    {p.update_source === 'unknown' && (
                      <span
                        className="badge badge-unknown"
                        title="Plugin fora do repositório oficial do WordPress. Não temos como saber se há versão mais nova."
                      >
                        atualização desconhecida
                      </span>
                    )}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
