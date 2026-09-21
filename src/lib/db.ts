import 'server-only';

// Acesso ao Postgres (Neon). Tudo aqui é server-only. Sites são compartilhados
// entre todos os usuários permitidos (mesmo domínio @f2f-digital.com): não há
// mais escopo por dono. `sites.added_by` só registra quem adicionou o site,
// não controla quem pode vê-lo ou geri-lo — isso é responsabilidade da
// autenticação (`requireUser`/`currentUser`) em cada entry point.

import { neon } from '@neondatabase/serverless';
import type { HealthCheck, Plugin, SiteInventory, Theme, WpSettings, WpUser } from './types';

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
 * único caminho de e-mail → id de usuário — usado pelos tokens do MCP (que
 * continuam por usuário, ver `tokens.ts`) e para gravar `sites.added_by`.
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

/** Todos os sites da equipe + resumo da varredura mais recente de cada um. */
export async function listSites(): Promise<SiteWithLatest[]> {
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
     ORDER BY s.created_at
  `) as SiteWithLatest[];
}

/** Insere se a URL ainda não existir; devolve o site em qualquer caso. */
export async function addSite(addedBy: string, url: string): Promise<SiteRow> {
  const rows = (await sql`
    INSERT INTO sites (added_by, url) VALUES (${addedBy}, ${url})
    ON CONFLICT (url) DO UPDATE SET url = EXCLUDED.url
    RETURNING id, url, label, created_at
  `) as SiteRow[];
  return rows[0];
}

export async function removeSite(siteId: string): Promise<void> {
  await sql`DELETE FROM sites WHERE id = ${siteId}`;
}

/** Resolve o site pela URL. Null quando nenhum site da equipe tem essa URL. */
export async function findSite(url: string): Promise<SiteRow | null> {
  const rows = (await sql`
    SELECT id, url, label, created_at
      FROM sites WHERE url = ${url}
  `) as SiteRow[];
  return rows[0] ?? null;
}

/** Todos os sites da equipe — usado pelo cron (mesma lista que `listSites`, sem o join do último scan). */
export async function listAllSites(): Promise<Array<SiteRow & { added_by: string }>> {
  return (await sql`
    SELECT id, added_by, url, label, created_at FROM sites ORDER BY created_at
  `) as Array<SiteRow & { added_by: string }>;
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

/** Snapshots dos recursos além de plugins. Chamado logo após saveScan. */
export async function saveInventoryExtras(
  scanId: string,
  { themes, users, settings, health }: Pick<SiteInventory, 'themes' | 'users' | 'settings' | 'health'>,
): Promise<void> {
  if (themes.length > 0) {
    await sql`
      INSERT INTO scan_themes (scan_id, stylesheet, name, version, is_active, has_update, new_version, update_source)
      SELECT ${scanId}, * FROM unnest(
        ${themes.map((t) => t.stylesheet)}::text[],
        ${themes.map((t) => t.name)}::text[],
        ${themes.map((t) => t.version)}::text[],
        ${themes.map((t) => t.is_active)}::boolean[],
        ${themes.map((t) => t.has_update)}::boolean[],
        ${themes.map((t) => t.new_version)}::text[],
        ${themes.map((t) => t.update_source)}::text[]
      )
      ON CONFLICT (scan_id, stylesheet) DO NOTHING
    `;
  }

  if (users.length > 0) {
    await sql`
      INSERT INTO scan_users (scan_id, wp_user_id, slug, name, roles)
      SELECT ${scanId}, * FROM unnest(
        ${users.map((u) => u.wp_user_id)}::integer[],
        ${users.map((u) => u.slug)}::text[],
        ${users.map((u) => u.name)}::text[],
        ${users.map((u) => u.roles)}::text[]
      )
      ON CONFLICT (scan_id, wp_user_id) DO NOTHING
    `;
  }

  if (settings) {
    await sql`
      INSERT INTO scan_settings (scan_id, title, description, url, admin_email, timezone, language)
      VALUES (${scanId}, ${settings.title}, ${settings.description}, ${settings.url},
              ${settings.admin_email}, ${settings.timezone}, ${settings.language})
      ON CONFLICT (scan_id) DO NOTHING
    `;
  }

  if (health.length > 0) {
    await sql`
      INSERT INTO scan_health (scan_id, test, status, label, badge)
      SELECT ${scanId}, * FROM unnest(
        ${health.map((h) => h.test)}::text[],
        ${health.map((h) => h.status)}::text[],
        ${health.map((h) => h.label)}::text[],
        ${health.map((h) => h.badge)}::text[]
      )
      ON CONFLICT (scan_id, test) DO NOTHING
    `;
  }
}

export async function scanThemes(scanId: string): Promise<Theme[]> {
  return (await sql`
    SELECT stylesheet, name, version, is_active, has_update, new_version, update_source
      FROM scan_themes
     WHERE scan_id = ${scanId} ORDER BY is_active DESC, name
  `) as Theme[];
}

export async function scanUsers(scanId: string): Promise<WpUser[]> {
  return (await sql`
    SELECT wp_user_id, slug, name, roles FROM scan_users
     WHERE scan_id = ${scanId} ORDER BY wp_user_id
  `) as WpUser[];
}

export async function scanSettings(scanId: string): Promise<WpSettings | null> {
  const rows = (await sql`
    SELECT title, description, url, admin_email, timezone, language
      FROM scan_settings WHERE scan_id = ${scanId}
  `) as WpSettings[];
  return rows[0] ?? null;
}

/**
 * Site Health de uma varredura, pior status primeiro. Ordem pensada para quem
 * vai operar: 'critical' precisa de ação agora, 'recommended' é a próxima
 * fila, 'unknown' é "não sabemos" (não é sinal de saúde nem de problema, mas
 * merece atenção antes do que um 'good' confirmado), e 'good' fecha a lista
 * porque não exige nada de ninguém.
 */
export async function scanHealth(scanId: string): Promise<HealthCheck[]> {
  return (await sql`
    SELECT test, status, label, badge FROM scan_health
     WHERE scan_id = ${scanId}
     ORDER BY CASE status
                WHEN 'critical'    THEN 0
                WHEN 'recommended' THEN 1
                WHEN 'unknown'     THEN 2
                WHEN 'good'        THEN 3
                ELSE 4
              END, test
  `) as HealthCheck[];
}
