import { describe, expect, it } from 'vitest';
import { mergePluginVersions, mergeThemeVersions } from './inventory';
import type { RawPlugin, RawTheme } from './types';

const raw: RawPlugin[] = [
  { file: 'elementor/elementor', name: 'Elementor', version: '3.21.5', is_active: true, slug: 'elementor' },
  { file: 'akismet/akismet', name: 'Akismet', version: '5.3.1', is_active: false, slug: 'akismet' },
  { file: 'acf-pro/acf-pro', name: 'ACF Pro', version: '6.2.0', is_active: true, slug: 'acf-pro' },
  { file: 'sem-versao/sem-versao', name: 'Sem Versão', version: null, is_active: true, slug: 'sem-versao' },
];

describe('mergePluginVersions', () => {
  it('marca desatualizado quando o wp.org tem versão maior', () => {
    const [elementor] = mergePluginVersions(raw, new Map([['elementor', '3.23.4']]));
    expect(elementor).toMatchObject({
      name: 'Elementor',
      has_update: true,
      new_version: '3.23.4',
      update_source: 'wporg',
    });
  });

  it('em dia quando as versões batem', () => {
    const merged = mergePluginVersions(raw, new Map([['akismet', '5.3.1']]));
    expect(merged.find((p) => p.name === 'Akismet')).toMatchObject({
      has_update: false,
      new_version: '',
      update_source: 'wporg',
    });
  });

  it('plugin fora do repositório fica unknown e NUNCA vira desatualizado', () => {
    const merged = mergePluginVersions(raw, new Map([['acf-pro', null]]));
    expect(merged.find((p) => p.name === 'ACF Pro')).toMatchObject({
      has_update: false,
      new_version: '',
      update_source: 'unknown',
    });
  });

  it('slug ausente do mapa também é unknown', () => {
    const merged = mergePluginVersions(raw, new Map());
    expect(merged.every((p) => p.update_source === 'unknown')).toBe(true);
  });

  it('versão instalada desconhecida NUNCA vira desatualizado', () => {
    // Regressão: versão ilegível fazia parse() ler 0, e 0 < 6 marcava pendência
    // em plugin cuja versão o site nem informou. Ver isComparableVersion.
    const merged = mergePluginVersions(raw, new Map([['sem-versao', '6.0.0']]));
    expect(merged.find((p) => p.name === 'Sem Versão')).toMatchObject({
      version: '—',
      has_update: false,
      new_version: '',
      update_source: 'unknown',
    });
  });

  it('preserva file, nome, versão e estado ativo', () => {
    const [elementor] = mergePluginVersions(raw, new Map([['elementor', '3.23.4']]));
    expect(elementor.file).toBe('elementor/elementor');
    expect(elementor.version).toBe('3.21.5');
    expect(elementor.is_active).toBe(true);
  });
});

const rawThemes: RawTheme[] = [
  { stylesheet: 'twentytwentyfive', name: 'Twenty Twenty-Five', version: '1.2', is_active: true },
  { stylesheet: 'twentytwentyfour', name: 'Twenty Twenty-Four', version: '1.2', is_active: false },
  { stylesheet: 'tema-custom', name: 'Tema Custom', version: '2.0.0', is_active: false },
  { stylesheet: 'tema-sem-versao', name: 'Tema Sem Versão', version: null, is_active: false },
];

describe('mergeThemeVersions', () => {
  it('marca desatualizado quando o wp.org tem versão maior', () => {
    const merged = mergeThemeVersions(rawThemes, new Map([['twentytwentyfive', '1.5']]));
    expect(merged.find((t) => t.stylesheet === 'twentytwentyfive')).toMatchObject({
      has_update: true,
      new_version: '1.5',
      update_source: 'wporg',
    });
  });

  it('em dia quando as versões batem', () => {
    const merged = mergeThemeVersions(rawThemes, new Map([['twentytwentyfour', '1.2']]));
    expect(merged.find((t) => t.stylesheet === 'twentytwentyfour')).toMatchObject({
      has_update: false,
      new_version: '',
      update_source: 'wporg',
    });
  });

  it('tema fora do repositório fica unknown e NUNCA vira desatualizado', () => {
    const merged = mergeThemeVersions(rawThemes, new Map([['tema-custom', null]]));
    expect(merged.find((t) => t.stylesheet === 'tema-custom')).toMatchObject({
      has_update: false,
      new_version: '',
      update_source: 'unknown',
    });
  });

  it('stylesheet ausente do mapa também é unknown', () => {
    const merged = mergeThemeVersions(rawThemes, new Map());
    expect(merged.every((t) => t.update_source === 'unknown')).toBe(true);
  });

  it('versão instalada desconhecida NUNCA vira desatualizado', () => {
    const merged = mergeThemeVersions(rawThemes, new Map([['tema-sem-versao', '3.0.0']]));
    expect(merged.find((t) => t.stylesheet === 'tema-sem-versao')).toMatchObject({
      version: '—',
      has_update: false,
      new_version: '',
      update_source: 'unknown',
    });
  });

  it('preserva stylesheet, nome e estado ativo', () => {
    const [primeiro] = mergeThemeVersions(rawThemes, new Map([['twentytwentyfive', '1.5']]));
    expect(primeiro.stylesheet).toBe('twentytwentyfive');
    expect(primeiro.name).toBe('Twenty Twenty-Five');
    expect(primeiro.is_active).toBe(true);
  });
});
