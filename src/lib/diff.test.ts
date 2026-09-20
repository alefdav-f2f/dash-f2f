import { describe, expect, it } from 'vitest';
import { diffScans, diffSettings, diffThemes, diffUsers } from './diff';
import type { Theme, WpSettings, WpUser } from './types';

// diffScans (plugins) já tinha cobertura em produção antes deste arquivo existir;
// mantemos um teste mínimo aqui para não deixar `diff.ts` sem suíte própria.
describe('diffScans', () => {
  it('primeira varredura (previous vazio) não reporta nada', () => {
    expect(diffScans([{ file: 'a/a.php', name: 'A', version: '1.0', is_active: true, has_update: false, new_version: '1.0', update_source: 'site' }], [])).toEqual([]);
  });
});

function user(overrides: Partial<WpUser> = {}): WpUser {
  return { wp_user_id: 1, slug: 'ana', name: 'Ana', roles: 'editor', ...overrides };
}

describe('diffUsers', () => {
  it('usuário presente agora e ausente antes vira novo', () => {
    const current = [user({ wp_user_id: 1 }), user({ wp_user_id: 2, slug: 'bia', name: 'Bia' })];
    const previous = [user({ wp_user_id: 1 })];
    const changes = diffUsers(current, previous);
    expect(changes).toEqual([{ kind: 'new', file: '2', name: 'Bia', to: 'editor', resource: 'user' }]);
  });

  it('usuário ausente agora e presente antes vira removido', () => {
    const current = [user({ wp_user_id: 1 })];
    const previous = [user({ wp_user_id: 1 }), user({ wp_user_id: 2, slug: 'bia', name: 'Bia' })];
    const changes = diffUsers(current, previous);
    expect(changes).toEqual([{ kind: 'removed', file: '2', name: 'Bia', from: 'editor', resource: 'user' }]);
  });

  it('mudança de papel comum carrega antes e depois', () => {
    const current = [user({ roles: 'editor' })];
    const previous = [user({ roles: 'author' })];
    const changes = diffUsers(current, previous);
    expect(changes).toEqual([{ kind: 'role-changed', file: '1', name: 'Ana', from: 'author', to: 'editor', resource: 'user' }]);
  });

  it('elevação a administrator tem tipo próprio, distinto de mudança de papel comum', () => {
    const current = [user({ roles: 'administrator' })];
    const previous = [user({ roles: 'editor' })];
    const changes = diffUsers(current, previous);
    expect(changes).toEqual([{ kind: 'admin-elevated', file: '1', name: 'Ana', from: 'editor', to: 'administrator', resource: 'user' }]);
    expect(changes[0].kind).not.toBe('role-changed');
  });

  it('perder administrator também é identificável, com seu próprio tipo', () => {
    const current = [user({ roles: 'editor' })];
    const previous = [user({ roles: 'administrator' })];
    const changes = diffUsers(current, previous);
    expect(changes).toEqual([{ kind: 'admin-demoted', file: '1', name: 'Ana', from: 'administrator', to: 'editor', resource: 'user' }]);
    expect(changes[0].kind).not.toBe('role-changed');
  });

  it('usuário sem mudança não produz nada', () => {
    const current = [user()];
    const previous = [user()];
    expect(diffUsers(current, previous)).toEqual([]);
  });

  it('previous vazio (primeira varredura) não reporta ninguém como novo', () => {
    const current = [user({ wp_user_id: 1 }), user({ wp_user_id: 2, slug: 'bia', name: 'Bia' })];
    expect(diffUsers(current, [])).toEqual([]);
  });
});

function theme(overrides: Partial<Theme> = {}): Theme {
  return {
    stylesheet: 'twentytwentyfour',
    name: 'Twenty Twenty-Four',
    version: '1.0',
    is_active: true,
    has_update: false,
    new_version: '1.0',
    update_source: 'unknown',
    ...overrides,
  };
}

describe('diffThemes', () => {
  it('tema novo', () => {
    const current = [theme({ stylesheet: 'a' }), theme({ stylesheet: 'b', name: 'B' })];
    const previous = [theme({ stylesheet: 'a' })];
    expect(diffThemes(current, previous)).toEqual([{ kind: 'new', file: 'b', name: 'B', to: '1.0', resource: 'theme' }]);
  });

  it('tema removido', () => {
    const current = [theme({ stylesheet: 'a' })];
    const previous = [theme({ stylesheet: 'a' }), theme({ stylesheet: 'b', name: 'B' })];
    expect(diffThemes(current, previous)).toEqual([{ kind: 'removed', file: 'b', name: 'B', from: '1.0', resource: 'theme' }]);
  });

  it('versão mudou carrega de/para', () => {
    const current = [theme({ version: '1.1' })];
    const previous = [theme({ version: '1.0' })];
    expect(diffThemes(current, previous)).toEqual([{ kind: 'updated', file: 'twentytwentyfour', name: 'Twenty Twenty-Four', from: '1.0', to: '1.1', resource: 'theme' }]);
  });

  it('ativação mudou fica óbvia: o tema que virou ativo aparece como activated', () => {
    const current = [
      theme({ stylesheet: 'a', name: 'A', is_active: true }),
      theme({ stylesheet: 'b', name: 'B', is_active: false }),
    ];
    const previous = [
      theme({ stylesheet: 'a', name: 'A', is_active: false }),
      theme({ stylesheet: 'b', name: 'B', is_active: true }),
    ];
    const changes = diffThemes(current, previous);
    expect(changes).toContainEqual({ kind: 'activated', file: 'a', name: 'A', resource: 'theme' });
    expect(changes).toContainEqual({ kind: 'deactivated', file: 'b', name: 'B', resource: 'theme' });
  });

  it('previous vazio (primeira varredura) não reporta nada', () => {
    const current = [theme({ stylesheet: 'a' }), theme({ stylesheet: 'b' })];
    expect(diffThemes(current, [])).toEqual([]);
  });
});

function settings(overrides: Partial<WpSettings> = {}): WpSettings {
  return {
    title: 'Meu site',
    description: 'Um site WordPress',
    url: 'https://exemplo.com',
    admin_email: 'admin@exemplo.com',
    timezone: 'America/Sao_Paulo',
    language: 'pt_BR',
    ...overrides,
  };
}

describe('diffSettings', () => {
  it('admin_email mudando é sinal clássico de account takeover — precisa aparecer', () => {
    const current = settings({ admin_email: 'invasor@fora.com' });
    const previous = settings({ admin_email: 'admin@exemplo.com' });
    expect(diffSettings(current, previous)).toEqual([
      { kind: 'setting-changed', file: 'admin_email', name: 'admin_email', from: 'admin@exemplo.com', to: 'invasor@fora.com', resource: 'settings' },
    ]);
  });

  it('url mudando é coberta', () => {
    const current = settings({ url: 'https://novo-dominio.com' });
    const previous = settings({ url: 'https://exemplo.com' });
    expect(diffSettings(current, previous)).toEqual([
      { kind: 'setting-changed', file: 'url', name: 'url', from: 'https://exemplo.com', to: 'https://novo-dominio.com', resource: 'settings' },
    ]);
  });

  it('campo a campo: várias mudanças viram várias entradas', () => {
    const current = settings({ title: 'Novo título', language: 'en_US' });
    const previous = settings({ title: 'Meu site', language: 'pt_BR' });
    const changes = diffSettings(current, previous);
    expect(changes).toContainEqual({ kind: 'setting-changed', file: 'title', name: 'title', from: 'Meu site', to: 'Novo título', resource: 'settings' });
    expect(changes).toContainEqual({ kind: 'setting-changed', file: 'language', name: 'language', from: 'pt_BR', to: 'en_US', resource: 'settings' });
    expect(changes).toHaveLength(2);
  });

  it('null em qualquer lado não produz nada — não há o que comparar', () => {
    expect(diffSettings(null, settings())).toEqual([]);
    expect(diffSettings(settings(), null)).toEqual([]);
    expect(diffSettings(null, null)).toEqual([]);
  });

  it('settings idênticas não produzem nada', () => {
    expect(diffSettings(settings(), settings())).toEqual([]);
  });
});
