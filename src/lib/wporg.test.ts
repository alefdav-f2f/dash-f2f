import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchFromWporg, fetchThemeFromWporg, parseWporgResponse } from './wporg';

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

describe('fetchThemeFromWporg', () => {
  it('200 com versão é fato', async () => {
    vi.stubGlobal('fetch', respond({ version: '1.5' }));
    expect(await fetchThemeFromWporg('twentytwentyfive')).toEqual({ known: true, version: '1.5' });
  });

  it('404 com corpo false é fato: o tema não está no repositório', async () => {
    vi.stubGlobal('fetch', respond(false, 404));
    expect(await fetchThemeFromWporg('tema-que-nao-existe')).toEqual({ known: true, version: null });
  });

  it('500 NÃO é fato — não sabemos, e isso não pode virar cache', async () => {
    vi.stubGlobal('fetch', respond({}, 500));
    expect(await fetchThemeFromWporg('astra')).toEqual({ known: false });
  });

  it('falha de rede NÃO é fato', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    expect(await fetchThemeFromWporg('astra')).toEqual({ known: false });
  });

  it('consulta o endpoint de temas, não o de plugins', async () => {
    const fetchMock = respond({ version: '1.5' });
    vi.stubGlobal('fetch', fetchMock);
    await fetchThemeFromWporg('twentytwentyfive');
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('themes/info/1.1');
    expect(url).toContain('twentytwentyfive');
  });
});

describe('conexão com o banco é preguiçosa', () => {
  // O import deste arquivo já aconteceu no topo, sem DATABASE_URL setada no
  // ambiente de teste (vitest roda `npm test` sem --env-file). Se `wporg.ts`
  // voltasse a criar o client Neon em escopo de módulo, esse import teria
  // lançado ANTES de qualquer teste rodar — o arquivo inteiro apareceria como
  // falha de coleta, não como teste vermelho.
  //
  // NÃO prova: que `latestVersions` funciona sem banco — ela precisa de um de
  // verdade, e isso é responsabilidade do teste de integração manual (ver
  // relatório da tarefa). Só prova que importar o módulo e chamar a função
  // pura de rede não exige DATABASE_URL.
  it('DATABASE_URL ausente não impede o uso de fetchFromWporg', async () => {
    expect(process.env.DATABASE_URL).toBeUndefined();
    vi.stubGlobal('fetch', respond({ version: '1.2.3' }));
    expect(await fetchFromWporg('qualquer-plugin')).toEqual({ known: true, version: '1.2.3' });
  });
});
