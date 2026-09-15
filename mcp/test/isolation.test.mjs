// Isolamento por usuário: as queries do MCP jamais podem devolver dado de outro
// dono. Semeia dois usuários com sites e varreduras, consulta como um deles e
// limpa tudo no final.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { neon } from '@neondatabase/serverless';

const require = createRequire(import.meta.url);
const q = require('../dist/src/lib/mcp/queries.js');
const { resolveOwnerId } = require('../dist/src/lib/mcp/db.js');

const admin = neon(process.env.DATABASE_URL);

const OWNER_A = 'test-owner-a-dash-f2f';
const OWNER_B = 'test-owner-b-dash-f2f';
const URL_A = 'https://site-a.teste-dash-f2f.example';
const URL_B = 'https://site-b.teste-dash-f2f.example';

async function seed() {
  await cleanup();

  await admin`INSERT INTO app_users (id, email, name) VALUES (${OWNER_A}, 'a@teste-dash-f2f.example', 'Teste A')`;
  await admin`INSERT INTO app_users (id, email, name) VALUES (${OWNER_B}, 'b@teste-dash-f2f.example', 'Teste B')`;

  const [siteA] = await admin`INSERT INTO sites (owner_id, url) VALUES (${OWNER_A}, ${URL_A}) RETURNING id`;
  const [siteB] = await admin`INSERT INTO sites (owner_id, url) VALUES (${OWNER_B}, ${URL_B}) RETURNING id`;

  // A: duas varreduras — na segunda, o Elementor foi atualizado e o Yoast ficou desatualizado.
  const [scanA1] = await admin`
    INSERT INTO scans (site_id, ok, total, active, outdated, inactive, source, fetched_at)
    VALUES (${siteA.id}, true, 2, 2, 1, 0, 'manual', now() - interval '1 day') RETURNING id`;
  await admin`
    INSERT INTO scan_plugins (scan_id, file, name, version, new_version, is_active, has_update) VALUES
      (${scanA1.id}, 'elementor/elementor.php', 'Elementor', '3.24.4', '3.26.0', true, true),
      (${scanA1.id}, 'wordpress-seo/wp-seo.php', 'Yoast SEO', '23.9', '', true, false)`;

  const [scanA2] = await admin`
    INSERT INTO scans (site_id, ok, total, active, outdated, inactive, source)
    VALUES (${siteA.id}, true, 2, 2, 1, 0, 'cron') RETURNING id`;
  await admin`
    INSERT INTO scan_plugins (scan_id, file, name, version, new_version, is_active, has_update) VALUES
      (${scanA2.id}, 'elementor/elementor.php', 'Elementor', '3.26.0', '', true, false),
      (${scanA2.id}, 'wordpress-seo/wp-seo.php', 'Yoast SEO', '23.9', '24.1', true, true)`;

  // B: uma varredura que falhou — não pode vazar para A de jeito nenhum.
  await admin`
    INSERT INTO scans (site_id, ok, error_kind, error_message, source)
    VALUES (${siteB.id}, false, 'network', 'site fora do ar', 'cron')`;

  return { siteA: siteA.id, siteB: siteB.id };
}

async function cleanup() {
  await admin`DELETE FROM sites WHERE owner_id IN (${OWNER_A}, ${OWNER_B})`;
  await admin`DELETE FROM app_users WHERE id IN (${OWNER_A}, ${OWNER_B})`;
}

test('queries do MCP são escopadas ao dono', async (t) => {
  const ids = await seed();
  t.after(cleanup);

  await t.test('resolveOwnerId encontra o usuário pelo e-mail', async () => {
    assert.equal(await resolveOwnerId('a@teste-dash-f2f.example'), OWNER_A);
    assert.equal(await resolveOwnerId('A@TESTE-DASH-F2F.EXAMPLE'), OWNER_A);
  });

  await t.test('resolveOwnerId falha com mensagem útil para e-mail desconhecido', async () => {
    await assert.rejects(
      () => resolveOwnerId('ninguem@teste-dash-f2f.example'),
      (err) => /Nenhum usuário/.test(err.message),
    );
  });

  await t.test('list_sites só vê o site do próprio dono', async () => {
    const sites = await q.listSites(OWNER_A);
    assert.equal(sites.length, 1);
    assert.equal(sites[0].url, URL_A);
    assert.equal(sites[0].last_source, 'cron');
    assert.equal(sites[0].last_outdated, 1);
  });

  await t.test('findSite recusa site de outro dono', async () => {
    assert.equal(await q.findSite(OWNER_A, URL_B), null);
    assert.ok(await q.findSite(OWNER_B, URL_B));
  });

  await t.test('scanPlugins recusa varredura de outro dono', async () => {
    const scansB = await q.scans(OWNER_B, ids.siteB, 5);
    assert.equal(scansB.length, 1);
    const vazado = await q.scanPlugins(OWNER_A, scansB[0].id);
    assert.deepEqual(vazado, []);
  });

  await t.test('list_outdated cobre só os sites do dono', async () => {
    const rows = await q.outdatedPlugins(OWNER_A);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'Yoast SEO');
    assert.equal(rows[0].site_url, URL_A);
  });

  await t.test('find_plugin não encontra plugin de outro dono', async () => {
    assert.equal((await q.findPlugin(OWNER_A, 'elementor', false)).length, 1);
    assert.equal((await q.findPlugin(OWNER_B, 'elementor', false)).length, 0);
  });

  await t.test('fleet_summary conta apenas o próprio parque', async () => {
    const a = await q.fleetSummary(OWNER_A);
    assert.equal(a.sites, 1);
    assert.equal(a.sites_failing, 0);
    assert.equal(a.sites_with_outdated, 1);
    assert.equal(a.outdated_plugins, 1);

    const b = await q.fleetSummary(OWNER_B);
    assert.equal(b.sites, 1);
    assert.equal(b.sites_failing, 1);
    assert.equal(b.sites_with_outdated, 0);
  });

  await t.test('list_failing_sites mostra a falha só para o dono dela', async () => {
    assert.deepEqual(await q.failingSites(OWNER_A), []);
    const falhas = await q.failingSites(OWNER_B);
    assert.equal(falhas.length, 1);
    assert.equal(falhas[0].error_kind, 'network');
    assert.equal(falhas[0].last_ok_at, null);
  });

  await t.test('diff entre as duas varreduras de A', async () => {
    const { diffScans } = require('../dist/src/lib/diff.js');
    const recent = (await q.scans(OWNER_A, ids.siteA, 10)).filter((s) => s.ok);
    assert.equal(recent.length, 2);

    const [novo, antigo] = await Promise.all([
      q.scanPlugins(OWNER_A, recent[0].id),
      q.scanPlugins(OWNER_A, recent[1].id),
    ]);
    const changes = diffScans(novo, antigo);

    const kinds = changes.map((c) => `${c.kind}:${c.name}`).sort();
    assert.deepEqual(kinds, ['updated:Elementor', 'update-available:Yoast SEO'].sort());
  });

  await t.test('clampLimit respeita o teto', () => {
    assert.equal(q.clampLimit(undefined, 10), 10);
    assert.equal(q.clampLimit(999, 10), q.MAX_LIMIT);
    assert.equal(q.clampLimit(0, 10), 10);
    assert.equal(q.clampLimit(3, 10), 3);
  });
});
