// Todas as consultas do MCP. SQL fixo e parametrizado — não existe caminho para
// SQL arbitrário vindo do agente. Toda função recebe `ownerId` como primeiro
// argumento e filtra por ele.

import { db } from './db';
import type { Plugin } from '../../src/lib/types';

export type SiteRow = {
  id: string;
  url: string;
  last_fetched_at: string | null;
  last_ok: boolean | null;
  last_total: number | null;
  last_outdated: number | null;
  last_error_kind: string | null;
  last_source: string | null;
};

export type ScanRow = {
  id: string;
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

export const MAX_LIMIT = 50;

export function clampLimit(value: number | undefined, fallback: number): number {
  if (!value || Number.isNaN(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), 1), MAX_LIMIT);
}

/** Sites do usuário + resumo da varredura mais recente de cada um. */
export async function listSites(ownerId: string): Promise<SiteRow[]> {
  const sql = db();
  return (await sql`
    SELECT s.id, s.url,
           last.fetched_at AS last_fetched_at,
           last.ok         AS last_ok,
           last.total      AS last_total,
           last.outdated   AS last_outdated,
           last.error_kind AS last_error_kind,
           last.source     AS last_source
      FROM sites s
      LEFT JOIN LATERAL (
        SELECT fetched_at, ok, total, outdated, error_kind, source
          FROM scans WHERE scans.site_id = s.id
         ORDER BY fetched_at DESC LIMIT 1
      ) last ON true
     WHERE s.owner_id = ${ownerId}
     ORDER BY s.created_at
  `) as SiteRow[];
}

/** Resolve a URL para um site do usuário. Null quando não existe ou não é dele. */
export async function findSite(ownerId: string, url: string): Promise<{ id: string; url: string } | null> {
  const sql = db();
  const rows = (await sql`
    SELECT id, url FROM sites WHERE owner_id = ${ownerId} AND url = ${url}
  `) as Array<{ id: string; url: string }>;
  return rows[0] ?? null;
}

/** Varreduras de um site, da mais nova para a mais antiga. */
export async function scans(ownerId: string, siteId: string, limit: number): Promise<ScanRow[]> {
  const sql = db();
  return (await sql`
    SELECT sc.id, sc.fetched_at, sc.ok, sc.error_kind, sc.error_message,
           sc.total, sc.active, sc.outdated, sc.inactive, sc.source
      FROM scans sc
      JOIN sites s ON s.id = sc.site_id AND s.owner_id = ${ownerId}
     WHERE sc.site_id = ${siteId}
     ORDER BY sc.fetched_at DESC
     LIMIT ${limit}
  `) as ScanRow[];
}

/** Snapshot de plugins de uma varredura (o join com sites re-checa a posse). */
export async function scanPlugins(ownerId: string, scanId: string): Promise<Plugin[]> {
  const sql = db();
  return (await sql`
    SELECT sp.file, sp.name, sp.version, sp.new_version, sp.is_active, sp.has_update
      FROM scan_plugins sp
      JOIN scans sc ON sc.id = sp.scan_id
      JOIN sites s  ON s.id = sc.site_id AND s.owner_id = ${ownerId}
     WHERE sp.scan_id = ${scanId}
     ORDER BY sp.name
  `) as Plugin[];
}

/** A varredura bem-sucedida mais recente de um site. */
export async function latestOkScan(ownerId: string, siteId: string): Promise<ScanRow | null> {
  const sql = db();
  const rows = (await sql`
    SELECT sc.id, sc.fetched_at, sc.ok, sc.error_kind, sc.error_message,
           sc.total, sc.active, sc.outdated, sc.inactive, sc.source
      FROM scans sc
      JOIN sites s ON s.id = sc.site_id AND s.owner_id = ${ownerId}
     WHERE sc.site_id = ${siteId} AND sc.ok = true
     ORDER BY sc.fetched_at DESC LIMIT 1
  `) as ScanRow[];
  return rows[0] ?? null;
}

export type OutdatedRow = {
  site_url: string;
  file: string;
  name: string;
  version: string;
  new_version: string;
  is_active: boolean;
  fetched_at: string;
};

/**
 * Plugins desatualizados na varredura mais recente de cada site.
 * `siteId` opcional restringe a um site.
 */
export async function outdatedPlugins(ownerId: string, siteId?: string): Promise<OutdatedRow[]> {
  const sql = db();
  return (await sql`
    WITH last_ok AS (
      SELECT DISTINCT ON (sc.site_id) sc.id, sc.site_id, sc.fetched_at
        FROM scans sc
        JOIN sites s ON s.id = sc.site_id AND s.owner_id = ${ownerId}
       WHERE sc.ok = true
         AND (${siteId ?? null}::uuid IS NULL OR sc.site_id = ${siteId ?? null}::uuid)
       ORDER BY sc.site_id, sc.fetched_at DESC
    )
    SELECT s.url AS site_url, sp.file, sp.name, sp.version, sp.new_version,
           sp.is_active, last_ok.fetched_at
      FROM last_ok
      JOIN scan_plugins sp ON sp.scan_id = last_ok.id
      JOIN sites s ON s.id = last_ok.site_id
     WHERE sp.has_update = true
     ORDER BY s.url, sp.name
  `) as OutdatedRow[];
}

export type PluginMatch = {
  site_url: string;
  file: string;
  name: string;
  version: string;
  new_version: string;
  is_active: boolean;
  has_update: boolean;
  fetched_at: string;
};

/** Onde um plugin está instalado, segundo a varredura mais recente de cada site. */
export async function findPlugin(ownerId: string, term: string, onlyOutdated: boolean): Promise<PluginMatch[]> {
  const sql = db();
  const like = `%${term}%`;
  return (await sql`
    WITH last_ok AS (
      SELECT DISTINCT ON (sc.site_id) sc.id, sc.site_id, sc.fetched_at
        FROM scans sc
        JOIN sites s ON s.id = sc.site_id AND s.owner_id = ${ownerId}
       WHERE sc.ok = true
       ORDER BY sc.site_id, sc.fetched_at DESC
    )
    SELECT s.url AS site_url, sp.file, sp.name, sp.version, sp.new_version,
           sp.is_active, sp.has_update, last_ok.fetched_at
      FROM last_ok
      JOIN scan_plugins sp ON sp.scan_id = last_ok.id
      JOIN sites s ON s.id = last_ok.site_id
     WHERE (sp.name ILIKE ${like} OR sp.file ILIKE ${like})
       AND (${onlyOutdated} = false OR sp.has_update = true)
     ORDER BY s.url, sp.name
  `) as PluginMatch[];
}

export type FleetSummary = {
  sites: number;
  sites_never_scanned: number;
  sites_failing: number;
  sites_with_outdated: number;
  outdated_plugins: number;
};

export async function fleetSummary(ownerId: string): Promise<FleetSummary> {
  const sql = db();
  const rows = (await sql`
    WITH last_scan AS (
      SELECT DISTINCT ON (sc.site_id) sc.site_id, sc.ok, sc.outdated
        FROM scans sc
        JOIN sites s ON s.id = sc.site_id AND s.owner_id = ${ownerId}
       ORDER BY sc.site_id, sc.fetched_at DESC
    )
    SELECT
      (SELECT count(*) FROM sites WHERE owner_id = ${ownerId})::int AS sites,
      (SELECT count(*) FROM sites s
        WHERE s.owner_id = ${ownerId}
          AND NOT EXISTS (SELECT 1 FROM last_scan ls WHERE ls.site_id = s.id))::int AS sites_never_scanned,
      (SELECT count(*) FROM last_scan WHERE ok = false)::int AS sites_failing,
      (SELECT count(*) FROM last_scan WHERE ok = true AND outdated > 0)::int AS sites_with_outdated,
      (SELECT COALESCE(sum(outdated), 0) FROM last_scan WHERE ok = true)::int AS outdated_plugins
  `) as FleetSummary[];
  return rows[0];
}

export type TopOutdated = { name: string; sites: number };

/** Plugins desatualizados que aparecem em mais sites. */
export async function topOutdated(ownerId: string, limit: number): Promise<TopOutdated[]> {
  const sql = db();
  return (await sql`
    WITH last_ok AS (
      SELECT DISTINCT ON (sc.site_id) sc.id, sc.site_id
        FROM scans sc
        JOIN sites s ON s.id = sc.site_id AND s.owner_id = ${ownerId}
       WHERE sc.ok = true
       ORDER BY sc.site_id, sc.fetched_at DESC
    )
    SELECT sp.name, count(DISTINCT last_ok.site_id)::int AS sites
      FROM last_ok
      JOIN scan_plugins sp ON sp.scan_id = last_ok.id
     WHERE sp.has_update = true
     GROUP BY sp.name
     ORDER BY sites DESC, sp.name
     LIMIT ${limit}
  `) as TopOutdated[];
}

export type FailingSite = {
  site_url: string;
  fetched_at: string;
  error_kind: string | null;
  error_message: string | null;
  last_ok_at: string | null;
};

/** Sites cuja varredura mais recente falhou. */
export async function failingSites(ownerId: string): Promise<FailingSite[]> {
  const sql = db();
  return (await sql`
    WITH last_scan AS (
      SELECT DISTINCT ON (sc.site_id) sc.site_id, sc.fetched_at, sc.ok, sc.error_kind, sc.error_message
        FROM scans sc
        JOIN sites s ON s.id = sc.site_id AND s.owner_id = ${ownerId}
       ORDER BY sc.site_id, sc.fetched_at DESC
    )
    SELECT s.url AS site_url, ls.fetched_at, ls.error_kind, ls.error_message,
           (SELECT max(fetched_at) FROM scans ok_scans
             WHERE ok_scans.site_id = ls.site_id AND ok_scans.ok = true) AS last_ok_at
      FROM last_scan ls
      JOIN sites s ON s.id = ls.site_id
     WHERE ls.ok = false
     ORDER BY ls.fetched_at DESC
  `) as FailingSite[];
}
