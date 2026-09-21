// Sites são compartilhados pela equipe (sql/011_shared_sites.sql): a garantia
// de antes — "dono A nunca vê site de dono B" — deixou de ser verdade de
// propósito, e um teste que ainda a cobrasse estaria testando um bug que não
// existe mais. A garantia nova, de força equivalente, é sobre QUEM abre a
// porta, não sobre QUAL fatia de dado cada um vê:
//
//   - todo usuário permitido enxerga o parque inteiro, incluindo site
//     cadastrado por outra pessoa;
//   - token revogado não enxerga nada;
//   - token de dono fora do domínio permitido não enxerga nada — mesmo que a
//     conta já exista em app_users (pode ter sido criada antes da checagem de
//     domínio existir, ver Task 3) e mesmo que o token nunca tenha sido
//     revogado.
//
// Semeia fixtures (usuários, sites, varreduras, tokens) e limpa tudo no final.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { neon } from '@neondatabase/serverless';

const require = createRequire(import.meta.url);
const q = require('../dist/src/lib/mcp/queries.js');
const { resolveOwnerId } = require('../dist/src/lib/mcp/db.js');
const { ownerForToken, createToken, revokeToken } = require('../dist/src/lib/tokens.js');
const { isAllowedEmail, getAllowedEmailDomains } = require('../dist/src/lib/allowed-email.js');

const admin = neon(process.env.DATABASE_URL);

// Usa o domínio permitido de verdade desta instância (ALLOWED_EMAIL_DOMAINS,
// ou o default) em vez de fixar 'f2f-digital.com': o teste continua válido
// mesmo que a allowlist deste ambiente seja outra.
const [ALLOWED_DOMAIN] = getAllowedEmailDomains();
const OFF_DOMAIN = 'mcp-test-fora-do-dominio.invalid';
assert.ok(
  !isAllowedEmail(`x@${OFF_DOMAIN}`),
  'domínio de teste precisa continuar fora da allowlist para o teste fazer sentido',
);

const OWNER_A = 'test-owner-a-dash-f2f'; // cadastrou o site A; dono de um token válido
const OWNER_B = 'test-owner-b-dash-f2f'; // cadastrou o site B — nunca usado para autenticar
const OWNER_OFF = 'test-owner-off-dash-f2f'; // existe em app_users, mas fora do domínio permitido

const EMAIL_A = `mcp-test-a@${ALLOWED_DOMAIN}`;
const EMAIL_B = `mcp-test-b@${ALLOWED_DOMAIN}`;
const EMAIL_OFF = `mcp-test-off@${OFF_DOMAIN}`;

const URL_A = 'https://site-a.teste-dash-f2f.example';
const URL_B = 'https://site-b.teste-dash-f2f.example';

let tokenA;
let tokenOff;
let tokenRevoked;

async function seed() {
  await cleanup();

  await admin`INSERT INTO app_users (id, email, name) VALUES (${OWNER_A}, ${EMAIL_A}, 'Teste A')`;
  await admin`INSERT INTO app_users (id, email, name) VALUES (${OWNER_B}, ${EMAIL_B}, 'Teste B')`;
  await admin`INSERT INTO app_users (id, email, name) VALUES (${OWNER_OFF}, ${EMAIL_OFF}, 'Teste fora do domínio')`;

  // added_by (ex-owner_id, sql/011_shared_sites.sql): registra quem cadastrou,
  // não recorta quem enxerga — por isso o site de B tem que aparecer para A.
  const [siteA] = await admin`INSERT INTO sites (added_by, url) VALUES (${OWNER_A}, ${URL_A}) RETURNING id`;
  const [siteB] = await admin`INSERT INTO sites (added_by, url) VALUES (${OWNER_B}, ${URL_B}) RETURNING id`;

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

  // B: uma varredura que falhou — tem que aparecer pra quem consulta como A.
  await admin`
    INSERT INTO scans (site_id, ok, error_kind, error_message, source)
    VALUES (${siteB.id}, false, 'network', 'site fora do ar', 'cron')`;

  // Três tokens: um vivo de dono no domínio permitido, um vivo de dono fora
  // do domínio, e um de A já revogado.
  tokenA = (await createToken(OWNER_A, 'token de teste A')).token;
  tokenOff = (await createToken(OWNER_OFF, 'token de teste fora do domínio')).token;
  const revoked = await createToken(OWNER_A, 'token de teste revogado');
  tokenRevoked = revoked.token;
  await revokeToken(OWNER_A, revoked.row.id);

  return { siteA: siteA.id, siteB: siteB.id };
}

async function cleanup() {
  await admin`DELETE FROM api_tokens WHERE owner_id IN (${OWNER_A}, ${OWNER_B}, ${OWNER_OFF})`;
  await admin`DELETE FROM sites WHERE added_by IN (${OWNER_A}, ${OWNER_B}, ${OWNER_OFF})`;
  await admin`DELETE FROM app_users WHERE id IN (${OWNER_A}, ${OWNER_B}, ${OWNER_OFF})`;
}

test('MCP: dado é da equipe inteira; só token de dono ativo e no domínio permitido abre a porta', async (t) => {
  const ids = await seed();
  t.after(cleanup);

  await t.test('resolveOwnerId aceita e-mail no domínio permitido', async () => {
    assert.equal(await resolveOwnerId(EMAIL_A), OWNER_A);
    assert.equal(await resolveOwnerId(EMAIL_A.toUpperCase()), OWNER_A);
  });

  await t.test('resolveOwnerId recusa e-mail fora do domínio permitido, mesmo já cadastrado em app_users', async () => {
    await assert.rejects(
      () => resolveOwnerId(EMAIL_OFF),
      (err) => /domínio permitido/.test(err.message),
    );
  });

  await t.test('resolveOwnerId falha com mensagem útil para e-mail desconhecido', async () => {
    await assert.rejects(
      () => resolveOwnerId(`ninguem@${ALLOWED_DOMAIN}`),
      (err) => /Nenhum usuário/.test(err.message),
    );
  });

  await t.test('list_sites não filtra por dono: mostra o site cadastrado por A e o cadastrado por B', async () => {
    const sites = await q.listSites();
    const urls = sites.map((s) => s.url);
    assert.ok(urls.includes(URL_A), 'site de A deveria aparecer');
    assert.ok(urls.includes(URL_B), 'site cadastrado por B também deveria aparecer — dado é da equipe');
  });

  await t.test('findSite resolve site cadastrado por qualquer um da equipe', async () => {
    assert.ok(await q.findSite(URL_A));
    assert.ok(await q.findSite(URL_B));
  });

  await t.test('scans/scanPlugins não recortam mais por dono', async () => {
    const scansB = await q.scans(ids.siteB, 5);
    assert.equal(scansB.length, 1);
    assert.equal(scansB[0].error_kind, 'network');
    // consulta plugins de uma varredura de B sem ownerId nenhum — só o scan_id importa agora.
    assert.deepEqual(await q.scanPlugins(scansB[0].id), []);
  });

  await t.test('list_outdated cobre o parque inteiro da equipe, não só quem cadastrou', async () => {
    const rows = await q.outdatedPlugins();
    assert.ok(rows.some((r) => r.site_url === URL_A && r.name === 'Yoast SEO'));
  });

  await t.test('find_plugin encontra plugin em site cadastrado por outra pessoa', async () => {
    const rows = await q.findPlugin('elementor', false);
    assert.ok(rows.some((r) => r.site_url === URL_A));
  });

  await t.test('fleet_summary soma o parque inteiro', async () => {
    const summary = await q.fleetSummary();
    assert.ok(summary.sites >= 2);
    assert.ok(summary.sites_failing >= 1);
    assert.ok(summary.sites_with_outdated >= 1);
  });

  await t.test('list_failing_sites mostra a falha de B independente de quem cadastrou', async () => {
    const falhas = await q.failingSites();
    const falhaB = falhas.find((f) => f.site_url === URL_B);
    assert.ok(falhaB);
    assert.equal(falhaB.error_kind, 'network');
    assert.equal(falhaB.last_ok_at, null);
  });

  await t.test('diff entre as duas varreduras de A', async () => {
    const { diffScans } = require('../dist/src/lib/diff.js');
    const recent = (await q.scans(ids.siteA, 10)).filter((s) => s.ok);
    assert.equal(recent.length, 2);

    const [novo, antigo] = await Promise.all([q.scanPlugins(recent[0].id), q.scanPlugins(recent[1].id)]);
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

  await t.test('ownerForToken: token de dono no domínio permitido resolve e identifica quem é', async () => {
    const owner = await ownerForToken(tokenA);
    assert.ok(owner);
    assert.equal(owner.ownerId, OWNER_A);
    assert.equal(owner.email, EMAIL_A);
  });

  await t.test('ownerForToken: token revogado não resolve a ninguém', async () => {
    assert.equal(await ownerForToken(tokenRevoked), null);
  });

  await t.test(
    'ownerForToken: token de dono fora do domínio permitido não resolve a ninguém — a propriedade que substitui o isolamento por dono',
    async () => {
      assert.equal(await ownerForToken(tokenOff), null);
    },
  );

  await t.test('ownerForToken: token ausente, vazio ou com prefixo errado não resolve', async () => {
    assert.equal(await ownerForToken(null), null);
    assert.equal(await ownerForToken(undefined), null);
    assert.equal(await ownerForToken('nao-comeca-com-o-prefixo-certo'), null);
    assert.equal(await ownerForToken('dashf2f_nao-existe-de-verdade'), null);
  });

  await t.test('ownerForToken só carimba last_used_at quando o token realmente resolve', async () => {
    const offRows = await admin`SELECT last_used_at FROM api_tokens WHERE owner_id = ${OWNER_OFF}`;
    assert.equal(offRows[0].last_used_at, null, 'token fora do domínio não deveria ter sido usado com sucesso');

    const aRows = await admin`SELECT last_used_at FROM api_tokens WHERE owner_id = ${OWNER_A} AND revoked_at IS NULL`;
    assert.ok(aRows[0].last_used_at, 'token válido de A deveria ter carimbo de uso, da chamada anterior');
  });
});
