import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchFromWporg, parseWporgResponse } from './wporg';

afterEach(() => vi.unstubAllGlobals());

function respond(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );
}

describe('parseWporgResponse', () => {
  it('extrai a versão publicada', () => {
    expect(parseWporgResponse({ name: 'Elementor', version: '3.23.4' })).toBe('3.23.4');
  });

  it('plugin inexistente vira null', () => {
    expect(parseWporgResponse({ error: 'Plugin not found.' })).toBeNull();
  });

  it('resposta false vira null', () => {
    expect(parseWporgResponse(false)).toBeNull();
  });

  it('resposta sem version vira null', () => {
    expect(parseWporgResponse({ name: 'Sem versão' })).toBeNull();
  });
});

describe('fetchFromWporg', () => {
  it('200 com versão é fato', async () => {
    vi.stubGlobal('fetch', respond({ version: '3.23.4' }));
    expect(await fetchFromWporg('elementor')).toEqual({ known: true, version: '3.23.4' });
  });

  it('404 é fato: o plugin não está no repositório', async () => {
    vi.stubGlobal('fetch', respond({ error: 'Plugin not found.' }, 404));
    expect(await fetchFromWporg('acf-pro')).toEqual({ known: true, version: null });
  });

  it('500 NÃO é fato — não sabemos, e isso não pode virar cache', async () => {
    vi.stubGlobal('fetch', respond({}, 500));
    expect(await fetchFromWporg('elementor')).toEqual({ known: false });
  });

  it('falha de rede NÃO é fato', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    expect(await fetchFromWporg('elementor')).toEqual({ known: false });
  });
});
