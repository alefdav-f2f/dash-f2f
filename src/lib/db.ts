import 'server-only';

// Acesso ao Postgres (Neon). Tudo aqui é server-only e escopado por owner_id —
// nenhuma query de site aceita ser chamada sem o dono.

import { neon } from '@neondatabase/serverless';
import type { Plugin } from './types';

const sql = neon(process.env.DATABASE_URL!);

export type SiteRow = {
  id: string;
  url: string;
  label: string | null;
  created_at: string;
};

export type SiteWithLatest = SiteRow & {
  last_fetched_at: string | null;
  last_ok: boolean | null;
  last_outdated: number | null;
  last_total: number | null;
  last_error_kind: string | null;
};

export type ScanRow = {
  id: string;
  site_id: string;
  fetched_at: string;
  ok: boolean;
  error_kind: string | null;
  error_message: string | null;
  total: number;
  active: number;
  outdated: number;
  inactive: number;
  source: string;
};

/* ── usuários ──────────────────────────────────────────────────────────── */

/**
 * Espelha o usuário da sessão em `app_users`.
 * O Neon Auth deste projeto não expõe `neon_auth.users_sync`, então este é o
 * único caminho de e-mail → owner_id — é o que o MCP usa para escopar leitura.
 */
export async function upsertUser(user: { id: string; email: string; name?: string | null }): Promise<void> {
  await sql`
    INSERT INTO app_users (id, email, name)
    VALUES (${user.id}, ${user.email}, ${user.name ?? null})
    ON CONFLICT (id) DO UPDATE
       SET email = EXCLUDED.email,
           name = COALESCE(EXCLUDED.name, app_users.name),
           last_seen = now()
  `;
}

/* ── sites ─────────────────────────────────────────────────────────────── */

/** Sites do usuário + resumo da varredura mais recente de cada um. */
export async function listSites(ownerId: string): Promise<SiteWithLatest[]> {
  return (await sql`
    SELECT s.id, s.url, s.label, s.created_at,
           last.fetched_at  AS last_fetched_at,
           last.ok          AS last_ok,
           last.outdated    AS last_outdated,
           last.total       AS last_total,
           last.error_kind  AS last_error_kind
      FROM sites s
      LEFT JOIN LATERAL (
        SELECT fetched_at, ok, outdated, total, error_kind
          FROM scans
         WHERE scans.site_id = s.id
         ORDER BY fetched_at DESC
         LIMIT 1
      ) last ON true
     WHERE s.owner_id = ${ownerId}
     ORDER BY s.created_at
  `) as SiteWithLatest[];
}

/** Insere se não existir; devolve o site em qualquer caso. */
export async function addSite(ownerId: string, url: string): Promise<SiteRow> {
  const rows = (await sql`
    INSERT INTO sites (owner_id, url) VALUES (${ownerId}, ${url})
    ON CONFLICT (owner_id, url) DO UPDATE SET url = EXCLUDED.url
    RETURNING id, url, label, created_at
  `) as SiteRow[];
  return rows[0];
}

export async function removeSite(ownerId: string, siteId: string): Promise<void> {
  await sql`DELETE FROM sites WHERE id = ${siteId} AND owner_id = ${ownerId}`;
}

/** Resolve o site pela URL garantindo a posse. Null quando não é do usuário. */
export async function findSite(ownerId: string, url: string): Promise<SiteRow | null> {
  const rows = (await sql`
    SELECT id, url, label, created_at
      FROM sites WHERE owner_id = ${ownerId} AND url = ${url}
  `) as SiteRow[];
  return rows[0] ?? null;
}

/** Todos os sites de todos os donos — só para o cron. */
export async function listAllSites(): Promise<Array<SiteRow & { owner_id: string }>> {
  return (await sql`
    SELECT id, owner_id, url, label, created_at FROM sites ORDER BY created_at
  `) as Array<SiteRow & { owner_id: string }>;
}

/* ── scans ─────────────────────────────────────────────────────────────── */

type SaveScanInput = {
  siteId: string;
  source: 'manual' | 'cron';
  plugins?: Plugin[];
  errorKind?: string;
  errorMessage?: string;
};

/** Grava o snapshot. Uma varredura com erro também vira linha (histórico honesto). */
export async function saveScan({
  siteId,
  source,
  plugins,
  errorKind,
  errorMessage,
}: SaveScanInput): Promise<string> {
  const ok = !errorKind;
  const list = plugins ?? [];
  const stats = {
    total: list.length,
    active: list.filter((p) => p.is_active).length,
    outdated: list.filter((p) => p.has_update).length,
    inactive: list.filter((p) => !p.is_active).length,
  };

  const rows = (await sql`
    INSERT INTO scans (site_id, ok, error_kind, error_message, total, active, outdated, inactive, source)
    VALUES (${siteId}, ${ok}, ${errorKind ?? null}, ${errorMessage ?? null},
            ${stats.total}, ${stats.active}, ${stats.outdated}, ${stats.inactive}, ${source})
    RETURNING id
  `) as Array<{ id: string }>;
  const scanId = rows[0].id;

  // O driver HTTP roda uma instrução por chamada: manda todas as linhas de uma
  // vez via unnest em vez de N inserts.
  if (list.length > 0) {
    await sql`
      INSERT INTO scan_plugins (scan_id, file, name, version, new_version, is_active, has_update, update_source)
      SELECT ${scanId}, * FROM unnest(
        ${list.map((p) => p.file || p.name)}::text[],
        ${list.map((p) => p.name)}::text[],
        ${list.map((p) => p.version)}::text[],
        ${list.map((p) => p.new_version)}::text[],
        ${list.map((p) => p.is_active)}::boolean[],
        ${list.map((p) => p.has_update)}::boolean[],
        ${list.map((p) => p.update_source)}::text[]
      )
      ON CONFLICT (scan_id, file) DO NOTHING
    `;
  }

  return scanId;
}

/** As N varreduras mais recentes de um site (a mais nova primeiro). */
export async function recentScans(siteId: string, limit = 2): Promise<ScanRow[]> {
  return (await sql`
    SELECT * FROM scans WHERE site_id = ${siteId}
     ORDER BY fetched_at DESC LIMIT ${limit}
  `) as ScanRow[];
}

/** Snapshot de plugins de uma varredura. */
export async function scanPlugins(scanId: string): Promise<Plugin[]> {
  return (await sql`
    SELECT file, name, version, new_version, is_active, has_update, update_source
      FROM scan_plugins WHERE scan_id = ${scanId} ORDER BY name
  `) as Plugin[];
}

/** Série histórica de desatualizados, para o sparkline. */
export async function outdatedHistory(siteId: string, limit = 30): Promise<Array<{ fetched_at: string; outdated: number }>> {
  const rows = (await sql`
    SELECT fetched_at, outdated FROM scans
     WHERE site_id = ${siteId} AND ok = true
     ORDER BY fetched_at DESC LIMIT ${limit}
  `) as Array<{ fetched_at: string; outdated: number }>;
  return rows.reverse();
}
