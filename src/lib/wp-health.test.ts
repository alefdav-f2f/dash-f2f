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

  it('roda as checagens uma de cada vez, nunca duas em voo ao mesmo tempo', async () => {
    // Regressão-alvo: se alguém trocar o laço sequencial por Promise.all de
    // novo, este teste falha — o pico de chamadas simultâneas passa de 1.
    let inFlight = 0;
    let peak = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      return new Promise((resolve) => {
        setTimeout(() => {
          inFlight -= 1;
          resolve(new Response(JSON.stringify({ ...GOOD, status: 'good' }), { status: 200 }));
        }, 5);
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const checks = await fetchSiteHealth('https://exemplo.com', CRED);

    expect(checks).toHaveLength(HEALTH_TESTS.length);
    expect(fetchMock).toHaveBeenCalledTimes(HEALTH_TESTS.length);
    expect(peak).toBe(1);
  });

  it('checagem que estoura o próprio timeout vira unknown sem afetar as outras', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (String(url).endsWith('https-status')) {
        // Nunca resolve por si só: só reage ao abort, como um fetch real faria
        // quando o AbortController de wpGet dispara ao estourar o timeout.
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      }
      return Promise.resolve(new Response(JSON.stringify({ ...GOOD, status: 'good' }), { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    // timeoutMs baixo só para o teste não esperar os 20s reais de produção.
    const checks = await fetchSiteHealth('https://exemplo.com', CRED, { timeoutMs: 20 });
    const byTest = Object.fromEntries(checks.map((c) => [c.test, c]));

    expect(checks).toHaveLength(HEALTH_TESTS.length);
    expect(byTest['https-status'].status).toBe('unknown');
    expect(checks.filter((c) => c.status === 'good')).toHaveLength(HEALTH_TESTS.length - 1);
  });

  it('quando o orçamento acaba, o restante vira unknown sem chamar fetch, e a lista continua com seis', async () => {
    // now() controlado manualmente: evita brigar com o AbortController de
    // wpGet (que usa setTimeout real) e mantém o teste determinístico e
    // rápido, sem esperar os 45s reais do orçamento de produção.
    // mockImplementation (não mockResolvedValue): cada chamada precisa de um
    // Response novo, porque o corpo só pode ser lido uma vez por .json().
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ ...GOOD, status: 'good' }), { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    // 1ª chamada calcula o deadline (base 0, orçamento 100 -> deadline 100).
    // As 6 chamadas seguintes são a checagem de orçamento no topo do laço,
    // uma por teste: as duas primeiras (0, 50) estão dentro do orçamento: as
    // quatro últimas (150 cada) já o estouraram.
    const now = vi
      .fn()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(50)
      .mockReturnValueOnce(150)
      .mockReturnValueOnce(150)
      .mockReturnValueOnce(150)
      .mockReturnValueOnce(150);

    const checks = await fetchSiteHealth('https://exemplo.com', CRED, { budgetMs: 100, now });

    expect(checks).toHaveLength(HEALTH_TESTS.length);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const skipped = checks.slice(2);
    expect(skipped.every((c) => c.status === 'unknown')).toBe(true);
    expect(skipped.every((c) => /orçamento/i.test(c.label))).toBe(true);
    expect(checks.filter((c) => c.status === 'good')).toHaveLength(2);
  });
});
