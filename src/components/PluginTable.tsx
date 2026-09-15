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
  const rows = plugins.filter(FILTERS[filter].test);

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
        <span className="count">exibindo {rows.length} de {stats.total}</span>
      </div>

      <table>
        <thead>
          <tr>
            <th style={{ width: '44%' }}>Plugin</th>
            <th style={{ width: '15%' }}>Versão atual</th>
            <th style={{ width: '15%' }}>Nova versão</th>
            <th style={{ width: '26%' }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} className="table-empty">Nenhum plugin neste filtro.</td>
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
                  <td data-col="versao"><span className="ver">{p.version}</span></td>
                  <td data-col="nova" className={hasNew ? undefined : 'is-empty'}>
                    {hasNew ? <span className="new">{p.new_version}</span> : <span className="ver dash">—</span>}
                  </td>
                  <td data-col="status">
                    <span className={`badge ${status.className}`}>{status.label}</span>
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
