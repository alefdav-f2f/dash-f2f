import 'server-only';

// Cifra dos segredos guardados no Postgres (hoje: Application Password de cada
// site). AES-256-GCM: confidencialidade + autenticação, então payload adulterado
// falha em vez de decifrar lixo.
//
// A chave vive em CREDENTIALS_KEY, FORA do banco. Um dump do Postgres sozinho
// não abre nenhuma credencial — é essa separação que faz o desenho valer.
//
// Duas classes de erro, propositalmente separadas:
// - CredentialsKeyError: problema de configuração da chave (ausente ou com
//   tamanho errado). Sinaliza que o servidor inteiro está mal configurado —
//   toda a frota fica indisponível até corrigir a env var.
// - SecretPayloadError: problema no ciphertext armazenado (formato
//   inesperado, versão desconhecida, IV/tag adulterados, chave errada ou
//   dado corrompido). Sinaliza um problema pontual daquele registro — quem
//   chama deve pedir a credencial de novo, não derrubar o serviço inteiro.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const TAG_BYTES = 16;

/** Configuração de chave ausente ou inválida. Erro de ambiente, não de dado. */
export class CredentialsKeyError extends Error {}

/** Ciphertext armazenado em formato inesperado, adulterado ou ilegível com a chave atual. */
export class SecretPayloadError extends Error {}

function key(): Buffer {
  const raw = process.env.CREDENTIALS_KEY;
  if (!raw) {
    throw new CredentialsKeyError(
      'CREDENTIALS_KEY ausente. Gere com: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }
  const buf = Buffer.from(raw, 'base64');
  // O comprimento aqui só pega lixo óbvio. A chave DEVE vir de
  // randomBytes(32) — nunca de uma senha/passphrase humana codificada em
  // base64, que teria muito menos de 256 bits de entropia real mesmo
  // passando nesse check.
  if (buf.length !== KEY_BYTES) {
    throw new CredentialsKeyError(`CREDENTIALS_KEY deve ter ${KEY_BYTES} bytes em base64 (tem ${buf.length}).`);
  }
  return buf;
}

/** Formato: `v1.<iv>.<tag>.<ciphertext>`, cada parte em base64url. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key(), iv, { authTagLength: TAG_BYTES });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}

export function decryptSecret(payload: string): string {
  // key() primeiro e fora do try/catch abaixo: chave ausente/inválida tem
  // que continuar levantando CredentialsKeyError, nunca ser mascarada como
  // problema de payload.
  const cryptoKey = key();

  const parts = String(payload ?? '').split('.');
  if (parts.length !== 4) {
    throw new SecretPayloadError('Payload cifrado em formato inesperado.');
  }
  const [version, iv, tag, data] = parts;
  if (version !== 'v1' || !iv || !tag) {
    throw new SecretPayloadError('Payload cifrado em formato inesperado.');
  }

  try {
    const decipher = createDecipheriv(ALGO, cryptoKey, Buffer.from(iv, 'base64url'), {
      authTagLength: TAG_BYTES,
    });
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // Mensagem fixa de propósito: o texto do Node não ajuda quem chama, e
    // manter a nossa estável permite que quem consome dependa da classe em
    // vez de fazer match de string.
    throw new SecretPayloadError('Não foi possível decifrar o segredo armazenado.');
  }
}
