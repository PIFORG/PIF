import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const KEY_VERSION = 1;
const ALGO = 'aes-256-gcm';

function keyFromHex(hex) {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('MFA encryption key must be 64 hex characters');
  }
  return Buffer.from(hex, 'hex');
}

/** AES-256-GCM: iv(12) || tag(16) || ciphertext, base64, prefixed with version. */
export function encryptMfaSecret(plaintext, keyHex) {
  const key = keyFromHex(keyHex);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const packed = Buffer.concat([iv, tag, encrypted]).toString('base64');
  return { ciphertext: `v${KEY_VERSION}:${packed}`, keyVersion: KEY_VERSION };
}

export function decryptMfaSecret(payload, keyHex) {
  const key = keyFromHex(keyHex);
  const [versionPart, data] = payload.split(':', 2);
  if (!versionPart || !data || !versionPart.startsWith('v')) {
    throw new Error('Invalid MFA ciphertext format');
  }
  const buf = Buffer.from(data, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
