import { afterEach, describe, expect, it, vi } from 'vitest';
import { HEALTH_TESTS, fetchSiteHealth, normalizeHealth } from './wp-health';

const CRED = { user: 'admin', password: 'abcd EFGH ijkl MNOP qrst UVWX' };

afterEach(() => vi.unstubAllGlobals());

function routed(map: Record<string, { status: number; body: unknown }>) {
  return vi.fn().mockImplementation((url: string) => {
    const hit = Object.entries(map).find(([slug]) => String(url).endsWith(slug));
    const { status, body } = hit ? hit[1] : { status: 500, body: {} };
    return Promise.resolve(
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
    );
  });
}

const GOOD = { test: 'dotorg_communication', status: 'good', label: 'Pode se comunicar', badge: { label: 'Segurança', color: 'blue' } };

describe('normalizeHealth', () => {
  it('achata o badge e mantém o slug da URL como identidade', () => {
    expect(normalizeHealth('dotorg-communication', GOOD)).toEqual({
      test: 'dotorg-communication',
      status: 'good',
      label: 'Pode se comunicar',
      badge: 'Segurança',
    });
  });

  it('status fora do vocabulário do WordPress vira unknown, NUNCA good', () => {
    expect(normalizeHealth('x', { ...GOOD, status: 'weird' }).status).toBe('unknown');
    expect(normalizeHealth('x', { ...GOOD, status: undefined }).status).toBe('unknown');
    expect(normalizeHealth('x', null).status).toBe('unknown');
  });

  it('aceita os três status reais do core', () => {
    for (const s of ['good', 'recommended', 'critical']) {
      expect(normalizeHealth('x', { ...GOOD, status: s }).status).toBe(s);
    }
  });

  it('badge ausente não quebra', () => {
    expect(normalizeHealth('x', { status: 'good' }).badge).toBe('');
  });
});

describe('fetchSiteHealth', () => {
  it('devolve um resultado por teste, sempre os seis', async () => {
    vi.stubGlobal('fetch', routed(Object.fromEntries(
      HEALTH_TESTS.map((t) => [t, { status: 200, body: { ...GOOD, status: 'good' } }]),
    )));

    const checks = await fetchSiteHealth('https://exemplo.com', CRED);
    expect(checks).toHaveLength(HEALTH_TESTS.length);
    expect(checks.map((c) => c.test).sort()).toEqual([...HEALTH_TESTS].sort());
  });

  it('um teste que falha não derruba os outros', async () => {
    vi.stubGlobal('fetch', routed({
      'authorization-header': { status: 500, body: {} },
      'background-updates': { status: 200, body: { ...GOOD, status: 'critical' } },
      'dotorg-communication': { status: 200, body: GOOD },
      'https-status': { status: 200, body: GOOD },
      'loopback-requests': { status: 200, body: GOOD },
      'page-cache': { status: 200, body: GOOD },
    }));

    const checks = await fetchSiteHealth('https://exemplo.com', CRED);
    const byTest = Object.fromEntries(checks.map((c) => [c.test, c]));
    expect(byTest['authorization-header'].status).toBe('unknown');
    expect(byTest['background-updates'].status).toBe('critical');
    expect(checks.filter((c) => c.status === 'good')).toHaveLength(4);
  });

  it('403 em tudo devolve seis unknown, não lista vazia', async () => {
    // Lista vazia pareceria "site saudável"; seis unknown dizem "não verificamos".
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 'rest_forbidden' }), { status: 403 }),
    ));

    const checks = await fetchSiteHealth('https://exemplo.com', CRED);
    expect(checks).toHaveLength(HEALTH_TESTS.length);
    expect(checks.every((c) => c.status === 'unknown')).toBe(true);
  });

  it('teste que falhou traz label dizendo que não foi verificado', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    const checks = await fetchSiteHealth('https://exemplo.com', CRED);
    expect(checks[0].label).toMatch(/não foi possível|não verificad/i);
  });
});
