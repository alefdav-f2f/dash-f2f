import { describe, expect, it } from 'vitest';
import { compareVersions, isComparableVersion, isOutdated } from './version';

describe('compareVersions', () => {
  it('compara segmentos numéricos', () => {
    expect(compareVersions('1.0.0', '1.0.1')).toBe(-1);
    expect(compareVersions('1.0.1', '1.0.0')).toBe(1);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });

  it('não compara como string: 3.21.5 é menor que 3.100.0', () => {
    expect(compareVersions('3.21.5', '3.100.0')).toBe(-1);
  });

  it('trata número diferente de segmentos', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1.2', '1.2.1')).toBe(-1);
  });

  it('pré-lançamento perde da versão final', () => {
    expect(compareVersions('1.0.0-beta1', '1.0.0')).toBe(-1);
    expect(compareVersions('1.0.0', '1.0.0-beta1')).toBe(1);
  });

  it('ignora segmento não numérico no meio sem explodir', () => {
    expect(compareVersions('1.0.x', '1.0.0')).toBe(0);
  });

  it('lida com 4+ segmentos (core do WordPress usa 4)', () => {
    expect(compareVersions('5.8.10.1', '5.8.10.2')).toBe(-1);
  });

  it('pré-lançamentos diferentes empatam entre si', () => {
    expect(compareVersions('1.0.0-beta1', '1.0.0-alpha1')).toBe(0);
  });
});

describe('isComparableVersion', () => {
  it('true quando há ao menos um dígito na parte numérica', () => {
    expect(isComparableVersion('3.21.5')).toBe(true);
    expect(isComparableVersion('1.0.x')).toBe(true);
    expect(isComparableVersion('1.2')).toBe(true);
    expect(isComparableVersion('1.0.0-beta1')).toBe(true);
  });

  it('false quando não há dígito legível, incluindo null/undefined', () => {
    expect(isComparableVersion('invalid')).toBe(false);
    expect(isComparableVersion('N/A')).toBe(false);
    expect(isComparableVersion('—')).toBe(false);
    expect(isComparableVersion('')).toBe(false);
    expect(isComparableVersion(null)).toBe(false);
    expect(isComparableVersion(undefined)).toBe(false);
  });
});

describe('isOutdated', () => {
  it('true quando a instalada é menor que a publicada', () => {
    expect(isOutdated('3.21.5', '3.23.4')).toBe(true);
  });

  it('false quando está em dia ou à frente', () => {
    expect(isOutdated('3.23.4', '3.23.4')).toBe(false);
    expect(isOutdated('4.0.0', '3.23.4')).toBe(false);
  });

  it('false quando não há versão publicada conhecida', () => {
    expect(isOutdated('3.21.5', null)).toBe(false);
  });

  it('versão instalada ilegível NUNCA vira desatualizado', () => {
    expect(isOutdated('invalid', '3.2.1')).toBe(false);
  });

  it('versão instalada como travessão (em dash) NUNCA vira desatualizado', () => {
    expect(isOutdated('—', '3.2.1')).toBe(false);
  });
});
