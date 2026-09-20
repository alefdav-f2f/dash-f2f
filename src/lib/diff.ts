// Comparação entre duas varreduras: o que mudou desde a anterior.
// Puro — recebe as duas listas e devolve o veredito por recurso.
//
// Isto é detecção de mudança, não log de auditoria: o WordPress não registra
// quem fez o quê, só o estado a cada varredura. "Ativação de admin mudou entre
// a varredura de ontem e a de hoje" é uma pergunta que dá para responder;
// "quem promoveu esse usuário" não dá, e o texto ao redor disso (Task 11) tem
// que deixar isso explícito.

import type { Plugin, Theme, WpSettings, WpUser } from './types';

export type ChangeKind =
  | 'new'            // item apareceu (plugin, tema ou usuário)
  | 'removed'        // sumiu
  | 'updated'        // versão instalada mudou (plugin ou tema)
  | 'activated'
  | 'deactivated'
  | 'update-available' // passou a ter atualização pendente
  | 'role-changed'      // papel de usuário mudou, sem envolver administrator
  | 'admin-elevated'    // usuário ganhou administrator — o evento que justifica a feature
  | 'admin-demoted'     // usuário perdeu administrator
  | 'setting-changed';  // campo de wp_options mudou

/**
 * Um único tipo `Change` para todos os recursos, e não um por recurso: a Task 11
 * agrupa por recurso e renderiza tudo numa lista só, então múltiplos formatos só
 * obrigariam a normalizar de volta na UI. `resource` ausente = plugin, para que
 * `diffScans` (e quem consome `Change` hoje) continue devolvendo exatamente o
 * mesmo formato de antes, sem o campo novo.
 */
export type ChangeResource = 'user' | 'theme' | 'settings';

export type Change = {
  kind: ChangeKind;
  /** Identificador do item dentro do recurso: file do plugin, stylesheet do
   *  tema, wp_user_id do usuário (como string) ou nome do campo de settings. */
  file: string;
  name: string;
  from?: string;
  to?: string;
  /** Recurso de origem. Ausente = plugin (compatibilidade com `diffScans`). */
  resource?: ChangeResource;
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

const ADMINISTRATOR = 'administrator';

const hasRole = (roles: string, role: string) =>
  roles.split(',').map((r) => r.trim()).includes(role);

/**
 * @param current lista da varredura mais recente
 * @param previous lista da varredura anterior (vazia = primeira varredura)
 */
export function diffUsers(current: WpUser[], previous: WpUser[]): Change[] {
  if (previous.length === 0) return [];

  const before = new Map(previous.map((u) => [u.wp_user_id, u]));
  const changes: Change[] = [];

  for (const u of current) {
    const old = before.get(u.wp_user_id);
    if (!old) {
      changes.push({ kind: 'new', file: String(u.wp_user_id), name: u.name, to: u.roles, resource: 'user' });
      continue;
    }
    if (old.roles !== u.roles) {
      const wasAdmin = hasRole(old.roles, ADMINISTRATOR);
      const isAdmin = hasRole(u.roles, ADMINISTRATOR);
      // Elevação (e perda) de administrator ganham tipo próprio: não basta o
      // rótulo dizer que é diferente, o `kind` também precisa ser — é o que
      // permite a UI (Task 11) destacar visualmente sem inspecionar `from`/`to`.
      const kind = !wasAdmin && isAdmin ? 'admin-elevated' : wasAdmin && !isAdmin ? 'admin-demoted' : 'role-changed';
      changes.push({ kind, file: String(u.wp_user_id), name: u.name, from: old.roles, to: u.roles, resource: 'user' });
    }
    before.delete(u.wp_user_id);
  }

  for (const [id, u] of before) {
    changes.push({ kind: 'removed', file: String(id), name: u.name, from: u.roles, resource: 'user' });
  }

  return changes;
}

const themeKey = (t: Theme) => t.stylesheet;

/**
 * @param current lista da varredura mais recente
 * @param previous lista da varredura anterior (vazia = primeira varredura)
 */
export function diffThemes(current: Theme[], previous: Theme[]): Change[] {
  if (previous.length === 0) return [];

  const before = new Map(previous.map((t) => [themeKey(t), t]));
  const changes: Change[] = [];

  for (const t of current) {
    const old = before.get(themeKey(t));
    if (!old) {
      changes.push({ kind: 'new', file: themeKey(t), name: t.name, to: t.version, resource: 'theme' });
      continue;
    }
    if (old.version !== t.version) {
      changes.push({ kind: 'updated', file: themeKey(t), name: t.name, from: old.version, to: t.version, resource: 'theme' });
    }
    if (old.is_active !== t.is_active) {
      // Troca de tema ativo é grande o bastante para valer sua própria linha,
      // mesmo sem mudança de versão junto.
      changes.push({ kind: t.is_active ? 'activated' : 'deactivated', file: themeKey(t), name: t.name, resource: 'theme' });
    }
    before.delete(themeKey(t));
  }

  for (const [stylesheet, t] of before) {
    changes.push({ kind: 'removed', file: stylesheet, name: t.name, from: t.version, resource: 'theme' });
  }

  return changes;
}

const SETTINGS_FIELDS: (keyof WpSettings)[] = ['title', 'description', 'url', 'admin_email', 'timezone', 'language'];

/**
 * @param current settings da varredura mais recente (`null` = não leu)
 * @param previous settings da varredura anterior (`null` = não leu, ou primeira varredura)
 */
export function diffSettings(current: WpSettings | null, previous: WpSettings | null): Change[] {
  if (!current || !previous) return [];

  const changes: Change[] = [];
  for (const field of SETTINGS_FIELDS) {
    if (current[field] !== previous[field]) {
      changes.push({ kind: 'setting-changed', file: field, name: field, from: previous[field], to: current[field], resource: 'settings' });
    }
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
  'role-changed': 'papel alterado',
  'admin-elevated': 'promovido a administrador',
  'admin-demoted': 'perdeu administrador',
  'setting-changed': 'configuração alterada',
};

/** Índice file → mudanças, para marcar linhas da tabela. */
export function changesByFile(changes: Change[]): Record<string, Change[]> {
  const map: Record<string, Change[]> = {};
  for (const c of changes) (map[c.file] ??= []).push(c);
  return map;
}
