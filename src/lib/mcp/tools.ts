// As 8 ferramentas do MCP, registradas uma vez e servidas pelos dois
// transportes: stdio (mcp/src/server.ts) e HTTP remoto (/api/mcp).
//
// Somente leitura em três camadas: a role do banco só tem SELECT, as consultas
// são SQL fixo e parametrizado, e cada tool se declara readOnlyHint.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import * as q from './queries';
import { CHANGE_LABEL, diffScans } from '../diff';
import { displayUrl, normalizeSiteUrl } from '../site-url';

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

/** Resposta padrão: um resumo legível + o JSON completo. */
function reply(summary: string, data: unknown) {
  return {
    content: [
      { type: 'text' as const, text: summary },
      { type: 'text' as const, text: JSON.stringify(data, null, 2) },
    ],
  };
}

function fail(message: string) {
  return { isError: true, content: [{ type: 'text' as const, text: message }] };
}

/** O driver devolve timestamptz como Date; no texto queremos ISO. */
function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

type SiteLookup =
  | { ok: false; error: string }
  | { ok: true; site: { id: string; url: string } };

/**
 * Cria o servidor MCP. Sites são compartilhados pela equipe (sql/011_shared_sites.sql):
 * não existe mais "dono" para escopar dado nenhum, então as queries não recebem
 * id de usuário — todo token válido enxerga o mesmo inventário completo.
 *
 * `accountLabel` (hoje, o e-mail de quem é dono do token/da sessão local) não
 * filtra nada; é só texto nas `instructions` do servidor, para quem estiver
 * olhando os logs do cliente MCP saber qual conta abriu aquela conexão. A
 * autorização de fato — só e-mail de domínio permitido chega até aqui — já
 * aconteceu antes: em `ownerForToken` (conector remoto) ou `resolveOwnerId`
 * (stdio local).
 */
export function createMcpServer(accountLabel: string): McpServer {
  const server = new McpServer(
    { name: 'dash-f2f', version: '1.0.0' },
    {
      instructions:
        `Leitura do painel dash-f2f para a conta ${accountLabel}. Expõe os sites WordPress ` +
        'monitorados e o histórico de varreduras de plugins, temas e usuários. Somente leitura: ' +
        'não altera nem o painel nem os sites WordPress.',
    },
  );

  async function siteOrError(rawUrl: string | undefined): Promise<SiteLookup> {
    if (!rawUrl) return { ok: false, error: 'Informe site_url.' };
    let url: string;
    try {
      url = normalizeSiteUrl(rawUrl);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'URL inválida.' };
    }
    const site = await q.findSite(url);
    if (!site) return { ok: false, error: `O site ${displayUrl(url)} não está cadastrado nesta conta.` };
    return { ok: true, site };
  }

  /* ── 1. list_sites ───────────────────────────────────────────────────── */
  server.registerTool(
    'list_sites',
    {
      title: 'Listar sites monitorados',
      description:
        'Todos os sites WordPress cadastrados na conta, com o resumo da varredura mais recente de cada um (quando, se respondeu, total de plugins e quantos estão desatualizados).',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      const sites = await q.listSites();
      if (sites.length === 0) return reply('Nenhum site cadastrado nesta conta.', []);

      const lines = sites.map((s) => {
        if (!s.last_fetched_at) return `${displayUrl(s.url)} — nunca varrido`;
        if (!s.last_ok) return `${displayUrl(s.url)} — última varredura falhou (${s.last_error_kind ?? 'erro'})`;
        return `${displayUrl(s.url)} — ${s.last_outdated}/${s.last_total} plugins desatualizados`;
      });
      return reply(`${sites.length} site(s):\n${lines.join('\n')}`, sites);
    },
  );

  /* ── 2. get_site_status ──────────────────────────────────────────────── */
  server.registerTool(
    'get_site_status',
    {
      title: 'Estado atual de um site',
      description:
        'Inventário completo de plugins de um site na varredura bem-sucedida mais recente: nome, versão instalada, nova versão e se está ativo.',
      inputSchema: { site_url: z.string().describe('URL do site, ex.: https://exemplo.com') },
      annotations: READ_ONLY,
    },
    async ({ site_url }) => {
      const found = await siteOrError(site_url);
      if (!found.ok) return fail(found.error);

      const scan = await q.latestOkScan(found.site.id);
      if (!scan) return reply(`Nenhuma varredura bem-sucedida para ${displayUrl(found.site.url)}.`, null);

      const plugins = await q.scanPlugins(scan.id);
      return reply(
        `${displayUrl(found.site.url)} em ${iso(scan.fetched_at)}: ${scan.total} plugins, ` +
          `${scan.active} ativos, ${scan.outdated} desatualizados, ${scan.inactive} inativos.`,
        { site: found.site.url, scan, plugins },
      );
    },
  );

  /* ── 3. list_outdated ────────────────────────────────────────────────── */
  server.registerTool(
    'list_outdated',
    {
      title: 'Plugins desatualizados',
      description:
        'Plugins com atualização pendente na varredura mais recente. Sem site_url, cobre todos os sites da conta.',
      inputSchema: {
        site_url: z.string().optional().describe('Restringe a um site; omita para varrer a conta inteira'),
      },
      annotations: READ_ONLY,
    },
    async ({ site_url }) => {
      let siteId: string | undefined;
      if (site_url) {
        const found = await siteOrError(site_url);
        if (!found.ok) return fail(found.error);
        siteId = found.site.id;
      }

      const rows = await q.outdatedPlugins(siteId);
      if (rows.length === 0) return reply('Nenhum plugin desatualizado.', []);

      const lines = rows.map(
        (r) =>
          `${displayUrl(r.site_url)} · ${r.name} ${r.version} → ${r.new_version || '?'}` +
          `${r.is_active ? '' : ' (inativo)'}`,
      );
      return reply(`${rows.length} plugin(s) desatualizado(s):\n${lines.join('\n')}`, rows);
    },
  );

  /* ── 4. get_scan_history ─────────────────────────────────────────────── */
  server.registerTool(
    'get_scan_history',
    {
      title: 'Histórico de varreduras',
      description:
        'Varreduras de um site, da mais recente para a mais antiga: quando, origem (manual ou cron), se respondeu e os contadores.',
      inputSchema: {
        site_url: z.string(),
        limit: z.number().int().optional().describe(`Máximo de varreduras (teto ${q.MAX_LIMIT}, padrão 10)`),
      },
      annotations: READ_ONLY,
    },
    async ({ site_url, limit }) => {
      const found = await siteOrError(site_url);
      if (!found.ok) return fail(found.error);

      const rows = await q.scans(found.site.id, q.clampLimit(limit, 10));
      if (rows.length === 0) return reply(`Nenhuma varredura para ${displayUrl(found.site.url)}.`, []);

      const lines = rows.map((s) =>
        s.ok
          ? `${iso(s.fetched_at)} · ${s.source} · ${s.outdated}/${s.total} desatualizados`
          : `${iso(s.fetched_at)} · ${s.source} · FALHOU (${s.error_kind ?? 'erro'})`,
      );
      return reply(`${rows.length} varredura(s) de ${displayUrl(found.site.url)}:\n${lines.join('\n')}`, rows);
    },
  );

  /* ── 5. diff_scans ───────────────────────────────────────────────────── */
  server.registerTool(
    'diff_scans',
    {
      title: 'O que mudou entre duas varreduras',
      description:
        'Compara duas varreduras de um site e lista as mudanças (novo, removido, atualizado, ativado, desativado, nova atualização). Sem ids, compara as duas varreduras bem-sucedidas mais recentes.',
      inputSchema: {
        site_url: z.string(),
        from_scan_id: z.string().optional().describe('Varredura antiga; padrão: a penúltima bem-sucedida'),
        to_scan_id: z.string().optional().describe('Varredura nova; padrão: a última bem-sucedida'),
      },
      annotations: READ_ONLY,
    },
    async ({ site_url, from_scan_id, to_scan_id }) => {
      const found = await siteOrError(site_url);
      if (!found.ok) return fail(found.error);

      let fromId = from_scan_id;
      let toId = to_scan_id;

      if (!fromId || !toId) {
        const recent = (await q.scans(found.site.id, q.MAX_LIMIT)).filter((s) => s.ok);
        if (recent.length < 2) {
          return reply(
            `${displayUrl(found.site.url)} tem menos de duas varreduras bem-sucedidas — nada a comparar.`,
            { changes: [] },
          );
        }
        toId = toId ?? recent[0].id;
        fromId = fromId ?? recent[1].id;
      }

      const [before, after] = await Promise.all([
        q.scanPlugins(fromId),
        q.scanPlugins(toId),
      ]);
      if (after.length === 0 && before.length === 0) {
        return fail('Varredura não encontrada nesta conta (verifique os ids).');
      }

      const changes = diffScans(after, before);
      const lines = changes.map((c) => {
        const versions = c.from && c.to ? ` ${c.from} → ${c.to}` : c.from ? ` ${c.from}` : '';
        return `${CHANGE_LABEL[c.kind]}: ${c.name}${versions}`;
      });
      return reply(
        changes.length === 0
          ? `Nada mudou em ${displayUrl(found.site.url)} entre as duas varreduras.`
          : `${changes.length} mudança(s) em ${displayUrl(found.site.url)}:\n${lines.join('\n')}`,
        { site: found.site.url, from_scan_id: fromId, to_scan_id: toId, changes },
      );
    },
  );

  /* ── 6. find_plugin ──────────────────────────────────────────────────── */
  server.registerTool(
    'find_plugin',
    {
      title: 'Onde um plugin está instalado',
      description:
        'Procura um plugin pelo nome ou pelo caminho (ex.: "elementor" ou "elementor/elementor.php") e mostra em quais sites ele existe e em que versão.',
      inputSchema: {
        plugin: z.string().describe('Trecho do nome ou do caminho do plugin'),
        only_outdated: z.boolean().optional().describe('Só os sites onde ele está desatualizado'),
      },
      annotations: READ_ONLY,
    },
    async ({ plugin, only_outdated }) => {
      const term = String(plugin ?? '').trim();
      if (term.length < 2) return fail('Informe pelo menos 2 caracteres.');

      const rows = await q.findPlugin(term, Boolean(only_outdated));
      if (rows.length === 0) return reply(`Nenhum site com plugin correspondente a "${term}".`, []);

      const lines = rows.map(
        (r) =>
          `${displayUrl(r.site_url)} · ${r.name} ${r.version}` +
          (r.has_update ? ` → ${r.new_version || '?'}` : '') +
          (r.is_active ? '' : ' (inativo)'),
      );
      return reply(`${rows.length} ocorrência(s) de "${term}":\n${lines.join('\n')}`, rows);
    },
  );

  /* ── 7. fleet_summary ────────────────────────────────────────────────── */
  server.registerTool(
    'fleet_summary',
    {
      title: 'Panorama da conta',
      description:
        'Visão geral: quantos sites, quantos com plugin desatualizado, quantos pararam de responder, quantos nunca foram varridos, e os plugins desatualizados que mais se repetem.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      const [summary, top] = await Promise.all([q.fleetSummary(), q.topOutdated(5)]);
      const topLine = top.length
        ? `\nMais recorrentes: ${top.map((t) => `${t.name} (${t.sites} site(s))`).join(', ')}`
        : '';
      return reply(
        `${summary.sites} site(s) · ${summary.sites_with_outdated} com pendência · ` +
          `${summary.sites_failing} sem responder · ${summary.sites_never_scanned} nunca varridos · ` +
          `${summary.outdated_plugins} plugin(s) desatualizado(s) no total.${topLine}`,
        { ...summary, top_outdated: top },
      );
    },
  );

  /* ── 8. list_failing_sites ───────────────────────────────────────────── */
  server.registerTool(
    'list_failing_sites',
    {
      title: 'Sites que pararam de responder',
      description:
        'Sites cuja varredura mais recente falhou, com o tipo de erro e a data da última varredura bem-sucedida.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      const rows = await q.failingSites();
      if (rows.length === 0) return reply('Todos os sites responderam na última varredura.', []);

      const lines = rows.map(
        (r) =>
          `${displayUrl(r.site_url)} · ${r.error_kind ?? 'erro'} em ${iso(r.fetched_at)}` +
          (r.last_ok_at ? ` · último sucesso: ${iso(r.last_ok_at)}` : ' · nunca teve sucesso'),
      );
      return reply(`${rows.length} site(s) com falha:\n${lines.join('\n')}`, rows);
    },
  );

  /* ── 9. get_site_themes ──────────────────────────────────────────────── */
  server.registerTool(
    'get_site_themes',
    {
      title: 'Temas instalados',
      description: 'Temas instalados no site na varredura mais recente, com versão e qual está ativo.',
      inputSchema: { site_url: z.string().describe('URL do site, ex.: https://exemplo.com') },
      annotations: READ_ONLY,
    },
    async ({ site_url }) => {
      const found = await siteOrError(site_url);
      if (!found.ok) return fail(found.error);
      const themes = await q.latestThemes(found.site.id);
      if (themes.length === 0) return reply('Nenhum tema registrado para este site.', []);
      const active = themes.find((t) => t.is_active);
      return reply(
        `${themes.length} tema(s) em ${displayUrl(found.site.url)}. Ativo: ${active ? `${active.name} ${active.version}` : 'nenhum identificado'}.`,
        themes,
      );
    },
  );

  /* ── 10. get_site_users ──────────────────────────────────────────────── */
  server.registerTool(
    'get_site_users',
    {
      title: 'Usuários do site',
      description:
        'Usuários do WordPress na varredura mais recente, com papéis. Útil para auditar quantas contas de administrador existem.',
      inputSchema: { site_url: z.string().describe('URL do site, ex.: https://exemplo.com') },
      annotations: READ_ONLY,
    },
    async ({ site_url }) => {
      const found = await siteOrError(site_url);
      if (!found.ok) return fail(found.error);
      const users = await q.latestUsers(found.site.id);
      if (users.length === 0) return reply('Nenhum usuário registrado para este site.', []);
      const admins = users.filter((u) => u.roles.split(',').includes('administrator')).length;
      return reply(
        `${users.length} usuário(s) em ${displayUrl(found.site.url)}, ${admins} com papel de administrador.`,
        users,
      );
    },
  );

  return server;
}
