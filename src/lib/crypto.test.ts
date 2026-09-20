import { beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { CredentialsKeyError, decryptSecret, encryptSecret } from './crypto';

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
});
