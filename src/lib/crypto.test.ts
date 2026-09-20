import { beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { CredentialsKeyError, SecretPayloadError, decryptSecret, encryptSecret } from './crypto';

beforeEach(() => {
  process.env.CREDENTIALS_KEY = randomBytes(32).toString('base64');
});

describe('encryptSecret / decryptSecret', () => {
  it('faz a volta completa', () => {
    const secret = 'abcd EFGH ijkl MNOP qrst UVWX';
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it('nunca repete o ciphertext para o mesmo texto (IV aleatório)', () => {
    expect(encryptSecret('mesmo')).not.toBe(encryptSecret('mesmo'));
  });

  it('não deixa o segredo aparecer em claro no payload', () => {
    expect(encryptSecret('senha-secreta')).not.toContain('senha-secreta');
  });

  it('rejeita payload adulterado (tag GCM)', () => {
    const payload = encryptSecret('original');
    const [v, iv, tag, data] = payload.split('.');
    const mexido = [v, iv, tag, Buffer.from('outra-coisa').toString('base64url')].join('.');
    expect(() => decryptSecret(mexido)).toThrow();
  });

  it('exige chave de 32 bytes', () => {
    process.env.CREDENTIALS_KEY = Buffer.from('curta').toString('base64');
    expect(() => encryptSecret('x')).toThrow(CredentialsKeyError);
  });

  it('falha claro quando a chave não existe', () => {
    delete process.env.CREDENTIALS_KEY;
    expect(() => encryptSecret('x')).toThrow(CredentialsKeyError);
  });

  it('rejeita decifragem com chave diferente da usada para cifrar', () => {
    const payload = encryptSecret('segredo-fleet');
    process.env.CREDENTIALS_KEY = randomBytes(32).toString('base64');
    expect(() => decryptSecret(payload)).toThrow(SecretPayloadError);
  });

  it('rejeita IV adulterado', () => {
    const payload = encryptSecret('original');
    const [v, , tag, data] = payload.split('.');
    const ivFalso = Buffer.from(randomBytes(12)).toString('base64url');
    const mexido = [v, ivFalso, tag, data].join('.');
    expect(() => decryptSecret(mexido)).toThrow(SecretPayloadError);
  });

  it('rejeita tag de autenticação adulterada', () => {
    const payload = encryptSecret('original');
    const [v, iv, , data] = payload.split('.');
    const tagFalsa = Buffer.from(randomBytes(16)).toString('base64url');
    const mexido = [v, iv, tagFalsa, data].join('.');
    expect(() => decryptSecret(mexido)).toThrow(SecretPayloadError);
  });

  it('rejeita tag de autenticação truncada (4 bytes)', () => {
    const payload = encryptSecret('original');
    const [v, iv, tag, data] = payload.split('.');
    const tagTruncada = Buffer.from(tag, 'base64url').subarray(0, 4).toString('base64url');
    const mexido = [v, iv, tagTruncada, data].join('.');
    expect(() => decryptSecret(mexido)).toThrow(SecretPayloadError);
  });

  it('faz a volta completa com texto vazio', () => {
    expect(decryptSecret(encryptSecret(''))).toBe('');
  });

  it('faz a volta completa com unicode (acentos, CJK, emoji)', () => {
    const secret = 'Senha em português com acentuação: café, ação. 日本語のテスト 🔐';
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it('rejeita prefixo de versão desconhecido', () => {
    const payload = encryptSecret('original');
    const [, iv, tag, data] = payload.split('.');
    const futuro = ['v2', iv, tag, data].join('.');
    expect(() => decryptSecret(futuro)).toThrow(SecretPayloadError);
  });

  it('rejeita payload com segmento extra no final', () => {
    const payload = encryptSecret('original');
    expect(() => decryptSecret(`${payload}.EXTRA`)).toThrow(SecretPayloadError);
  });

  it('falha com CredentialsKeyError (não SecretPayloadError) quando a chave não existe na decifragem', () => {
    const payload = encryptSecret('original');
    delete process.env.CREDENTIALS_KEY;
    expect(() => decryptSecret(payload)).toThrow(CredentialsKeyError);
  });
});
