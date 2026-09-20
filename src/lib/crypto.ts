import 'server-only';

// Cifra dos segredos guardados no Postgres (hoje: Application Password de cada
// site). AES-256-GCM: confidencialidade + autenticação, então payload adulterado
// falha em vez de decifrar lixo.
//
// A chave vive em CREDENTIALS_KEY, FORA do banco. Um dump do Postgres sozinho
// não abre nenhuma credencial — é essa separação que faz o desenho valer.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

export class CredentialsKeyError extends Error {}

function key(): Buffer {
  const raw = process.env.CREDENTIALS_KEY;
  if (!raw) {
    throw new CredentialsKeyError(
      'CREDENTIALS_KEY ausente. Gere com: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== KEY_BYTES) {
    throw new CredentialsKeyError(`CREDENTIALS_KEY deve ter ${KEY_BYTES} bytes em base64 (tem ${buf.length}).`);
  }
  return buf;
}

/** Formato: `v1.<iv>.<tag>.<ciphertext>`, cada parte em base64url. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}

export function decryptSecret(payload: string): string {
  const [version, iv, tag, data] = String(payload ?? '').split('.');
  if (version !== 'v1' || !iv || !tag || !data) {
    throw new CredentialsKeyError('Payload cifrado em formato inesperado.');
  }
  const decipher = createDecipheriv(ALGO, key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(data, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
