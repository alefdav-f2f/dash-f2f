import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WpError,
  collectInventory,
  fetchRawPlugins,
  fetchSettings,
  fetchThemes,
  fetchUsers,
  wporgSlug,
} from './wp-rest';

// collectInventory -> collectPlugins -> latestVersions faria uma consulta real
// ao Neon (DATABASE_URL não está setada em `npm test` puro). latestVersions já
// tem seu próprio teste de integração manual (ver wporg.test.ts); aqui ela é
// dependência de outra função, não o que está sob teste, então é stubada.
vi.mock('./wporg', () => ({
  latestVersions: vi.fn().mockResolvedValue(new Map()),
  latestThemeVersions: vi.fn().mockResolvedValue(new Map()),
}));

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

  it('slug vem do plugin_uri quando ele declara o do repositório', async () => {
    vi.stubGlobal('fetch', mockFetch(200, [
      { plugin: 'hello', status: 'active', name: 'Hello Dolly', version: '1.7.2',
        plugin_uri: 'http://wordpress.org/plugins/hello-dolly/', textdomain: 'hello-dolly' },
      { plugin: 'acme-pro-toolkit/acme-pro-toolkit', status: 'active', name: 'Acme Pro Toolkit',
        version: '2.3.1', plugin_uri: 'https://example.com/acme-pro-toolkit' },
    ]));

    const plugins = await fetchRawPlugins('https://exemplo.com', CRED);
    expect(plugins.map((p) => p.slug)).toEqual(['hello-dolly', 'acme-pro-toolkit']);
  });
});

describe('wporgSlug', () => {
  it('usa o nome do diretório quando plugin_uri está ausente', () => {
    expect(wporgSlug('elementor/elementor', undefined)).toBe('elementor');
  });

  it('usa o nome do diretório quando plugin_uri é vazio', () => {
    expect(wporgSlug('elementor/elementor', '')).toBe('elementor');
  });

  it('usa o nome do diretório quando plugin_uri não é do wordpress.org', () => {
    expect(wporgSlug('elementor/elementor', 'https://elementor.com/')).toBe('elementor');
  });

  it('o wordpress.org na plugin_uri vence o nome do diretório', () => {
    expect(wporgSlug('hello', 'http://wordpress.org/plugins/hello-dolly/')).toBe('hello-dolly');
  });

  it('funciona com https e sem barra final', () => {
    expect(wporgSlug('hello', 'https://wordpress.org/plugins/hello-dolly')).toBe('hello-dolly');
  });

  it('ignora query string e fragmento depois do slug', () => {
    expect(wporgSlug('hello', 'https://wordpress.org/plugins/hello-dolly?foo=1')).toBe('hello-dolly');
    expect(wporgSlug('hello', 'https://wordpress.org/plugins/hello-dolly#reviews')).toBe('hello-dolly');
  });

  it('plugin_uri não-string cai para o nome do diretório sem lançar', () => {
    expect(wporgSlug('hello', null)).toBe('hello');
    expect(wporgSlug('hello', undefined)).toBe('hello');
    expect(wporgSlug('hello', 42)).toBe('hello');
  });
});

describe('recursos adicionais', () => {
  it('normaliza temas e identifica o ativo', async () => {
    vi.stubGlobal('fetch', mockFetch(200, [
      { stylesheet: 'twentytwentyfour', name: { raw: 'Twenty Twenty-Four' }, version: '1.2', status: 'active' },
      { stylesheet: 'astra', name: { raw: 'Astra' }, version: '4.6.0', status: 'inactive' },
    ]));

    const themes = await fetchThemes('https://exemplo.com', CRED);
    expect(themes).toEqual([
      { stylesheet: 'twentytwentyfour', name: 'Twenty Twenty-Four', version: '1.2', is_active: true },
      { stylesheet: 'astra', name: 'Astra', version: '4.6.0', is_active: false },
    ]);
  });

  it('versão de tema ausente ou vazia vira null, nunca o placeholder de exibição', async () => {
    vi.stubGlobal('fetch', mockFetch(200, [
      { stylesheet: 'sem-versao', name: { raw: 'Sem Versão' }, status: 'active' },
      { stylesheet: 'vazia', name: { raw: 'Vazia' }, version: '', status: 'inactive' },
    ]));

    const themes = await fetchThemes('https://exemplo.com', CRED);
    expect(themes.map((t) => t.version)).toEqual([null, null]);
  });

  it('usuários trazem papéis achatados em string', async () => {
    vi.stubGlobal('fetch', mockFetch(200, [
      { id: 1, slug: 'admin', name: 'Admin', roles: ['administrator'] },
      { id: 4, slug: 'editora', name: 'Editora', roles: ['editor', 'author'] },
    ]));

    const users = await fetchUsers('https://exemplo.com', CRED);
    expect(users).toEqual([
      { wp_user_id: 1, slug: 'admin', name: 'Admin', roles: 'administrator' },
      { wp_user_id: 4, slug: 'editora', name: 'Editora', roles: 'editor,author' },
    ]);
  });

  it('settings vira objeto chato com defaults', async () => {
    vi.stubGlobal('fetch', mockFetch(200, {
      title: 'Meu Site', description: 'Só outro site', url: 'https://exemplo.com',
      email: 'admin@exemplo.com', timezone: 'America/Sao_Paulo', language: 'pt_BR',
    }));

    expect(await fetchSettings('https://exemplo.com', CRED)).toEqual({
      title: 'Meu Site',
      description: 'Só outro site',
      url: 'https://exemplo.com',
      admin_email: 'admin@exemplo.com',
      timezone: 'America/Sao_Paulo',
      language: 'pt_BR',
    });
  });
});

describe('collectInventory', () => {
  const PLUGINS = [{ plugin: 'akismet/akismet', status: 'active', name: 'Akismet', version: '5.3.1' }];

  /** Responde por rota, para simular um recurso falhando e os outros não. */
  function routedFetch(map: Record<string, { status: number; body: unknown }>) {
    return vi.fn().mockImplementation((url: string) => {
      const hit = Object.entries(map).find(([path]) => String(url).includes(path));
      const { status, body } = hit ? hit[1] : { status: 404, body: { code: 'rest_no_route' } };
      return Promise.resolve(
        new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
      );
    });
  }

  it('um recurso que falha não derruba os outros, e o motivo fica registrado', async () => {
    vi.stubGlobal('fetch', routedFetch({
      '/wp/v2/plugins': { status: 200, body: PLUGINS },
      '/wp/v2/themes': { status: 200, body: [{ stylesheet: 'astra', name: 'Astra', version: '4.6.0', status: 'active' }] },
      '/wp/v2/users': { status: 403, body: { code: 'rest_user_cannot_view' } },
      '/wp/v2/settings': { status: 200, body: { title: 'Meu Site' } },
    }));

    const inventory = await collectInventory('https://exemplo.com', CRED);

    expect(inventory.plugins).toHaveLength(1);
    expect(inventory.themes).toHaveLength(1);
    expect(inventory.users).toEqual([]);
    expect(inventory.settings?.title).toBe('Meu Site');
    // O que importa: a aba vazia tem motivo, não é silêncio.
    expect(inventory.failures.users).toBeTruthy();
    expect(inventory.failures.themes).toBeUndefined();
  });

  it('tudo lendo deixa failures vazio', async () => {
    vi.stubGlobal('fetch', routedFetch({
      '/wp/v2/plugins': { status: 200, body: PLUGINS },
      '/wp/v2/themes': { status: 200, body: [] },
      '/wp/v2/users': { status: 200, body: [] },
      '/wp/v2/settings': { status: 200, body: { title: 'X' } },
    }));

    const inventory = await collectInventory('https://exemplo.com', CRED);
    expect(inventory.failures).toEqual({});
  });
});
