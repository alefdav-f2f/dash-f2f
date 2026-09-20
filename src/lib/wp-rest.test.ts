import { afterEach, describe, expect, it, vi } from 'vitest';
import { WpError, fetchRawPlugins } from './wp-rest';

const CRED = { user: 'admin', password: 'abcd EFGH ijkl MNOP qrst UVWX' };

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue(
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchRawPlugins', () => {
  it('manda Basic auth e normaliza o slug a partir do campo plugin', async () => {
    const fetchMock = mockFetch(200, [
      { plugin: 'elementor/elementor', status: 'active', name: 'Elementor', version: '3.21.5' },
      { plugin: 'hello', status: 'inactive', name: 'Hello Dolly', version: '1.7.2' },
    ]);
    vi.stubGlobal('fetch', fetchMock);

    const plugins = await fetchRawPlugins('https://exemplo.com', CRED);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://exemplo.com/wp-json/wp/v2/plugins');
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe(
      'Basic ' + Buffer.from(`${CRED.user}:${CRED.password}`).toString('base64'),
    );

    expect(plugins).toEqual([
      { file: 'elementor/elementor', name: 'Elementor', version: '3.21.5', is_active: true, slug: 'elementor' },
      { file: 'hello', name: 'Hello Dolly', version: '1.7.2', is_active: false, slug: 'hello' },
    ]);
  });

  it('versão ausente ou vazia vira null, nunca o placeholder de exibição', async () => {
    vi.stubGlobal('fetch', mockFetch(200, [
      { plugin: 'sem-versao/sem-versao', status: 'active', name: 'Sem Versão' },
      { plugin: 'vazia/vazia', status: 'active', name: 'Vazia', version: '' },
    ]));

    const plugins = await fetchRawPlugins('https://exemplo.com', CRED);
    expect(plugins.map((p) => p.version)).toEqual([null, null]);
  });

  it('401 vira unauthorized', async () => {
    vi.stubGlobal('fetch', mockFetch(401, { code: 'incorrect_password' }));
    await expect(fetchRawPlugins('https://exemplo.com', CRED)).rejects.toMatchObject({ kind: 'unauthorized' });
  });

  it('403 vira forbidden', async () => {
    vi.stubGlobal('fetch', mockFetch(403, { code: 'rest_cannot_view_plugins' }));
    await expect(fetchRawPlugins('https://exemplo.com', CRED)).rejects.toMatchObject({ kind: 'forbidden' });
  });

  it('404 vira not_found', async () => {
    vi.stubGlobal('fetch', mockFetch(404, { code: 'rest_no_route' }));
    await expect(fetchRawPlugins('https://exemplo.com', CRED)).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('resposta que não é array vira bad_payload', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { nope: true }));
    await expect(fetchRawPlugins('https://exemplo.com', CRED)).rejects.toMatchObject({ kind: 'bad_payload' });
  });

  it('host interno é bloqueado antes de qualquer requisição', async () => {
    const fetchMock = mockFetch(200, []);
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchRawPlugins('http://192.168.0.10', CRED)).rejects.toMatchObject({ kind: 'invalid_url' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('erro nunca vaza a senha na mensagem', async () => {
    vi.stubGlobal('fetch', mockFetch(401, { code: 'incorrect_password' }));
    await expect(fetchRawPlugins('https://exemplo.com', CRED)).rejects.toSatisfy(
      (e: Error) => !e.message.includes(CRED.password),
    );
  });
});
