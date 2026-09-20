import { describe, expect, it } from 'vitest';
import { mergePluginVersions } from './inventory';
import type { RawPlugin } from './types';

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
