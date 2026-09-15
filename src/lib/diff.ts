// Comparação entre duas varreduras: o que mudou desde a anterior.
// Puro — recebe as duas listas e devolve o veredito por plugin.

import type { Plugin } from './types';

export type ChangeKind =
  | 'new'            // plugin apareceu no site
  | 'removed'        // sumiu do site
  | 'updated'        // versão instalada mudou
  | 'activated'
  | 'deactivated'
  | 'update-available'; // passou a ter atualização pendente

export type Change = {
  kind: ChangeKind;
  file: string;
  name: string;
  from?: string;
  to?: string;
};

const keyOf = (p: Plugin) => p.file || p.name;

/**
 * @param current lista da varredura mais recente
 * @param previous lista da varredura anterior (vazia = primeira varredura)
 */
export function diffScans(current: Plugin[], previous: Plugin[]): Change[] {
  if (previous.length === 0) return [];

  const before = new Map(previous.map((p) => [keyOf(p), p]));
  const changes: Change[] = [];

  for (const p of current) {
    const old = before.get(keyOf(p));
    if (!old) {
      changes.push({ kind: 'new', file: keyOf(p), name: p.name, to: p.version });
      continue;
    }
    if (old.version !== p.version) {
      changes.push({ kind: 'updated', file: keyOf(p), name: p.name, from: old.version, to: p.version });
    }
    if (old.is_active !== p.is_active) {
      changes.push({ kind: p.is_active ? 'activated' : 'deactivated', file: keyOf(p), name: p.name });
    }
    if (!old.has_update && p.has_update) {
      changes.push({ kind: 'update-available', file: keyOf(p), name: p.name, from: p.version, to: p.new_version });
    }
    before.delete(keyOf(p));
  }

  // o que sobrou no mapa não existe mais no site
  for (const [file, p] of before) {
    changes.push({ kind: 'removed', file, name: p.name, from: p.version });
  }

  return changes;
}

export const CHANGE_LABEL: Record<ChangeKind, string> = {
  new: 'novo',
  removed: 'removido',
  updated: 'atualizado',
  activated: 'ativado',
  deactivated: 'desativado',
  'update-available': 'nova atualização',
};

/** Índice file → mudanças, para marcar linhas da tabela. */
export function changesByFile(changes: Change[]): Record<string, Change[]> {
  const map: Record<string, Change[]> = {};
  for (const c of changes) (map[c.file] ??= []).push(c);
  return map;
}
