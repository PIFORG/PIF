import { decryptMfaSecret, encryptMfaSecret } from './mfa-crypto.util';

describe('mfa-crypto.util', () => {
  const key = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  it('round-trips AES-256-GCM encryption', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const enc = encryptMfaSecret(secret, key);
    expect(enc.ciphertext.startsWith('v1:')).toBe(true);
    expect(enc.keyVersion).toBe(1);
    expect(decryptMfaSecret(enc.ciphertext, key)).toEqual(secret);
  });

  it('produces different ciphertexts for same plaintext (random IV)', () => {
    const a = encryptMfaSecret('same', key);
    const b = encryptMfaSecret('same', key);
    expect(a.ciphertext).not.toEqual(b.ciphertext);
  });

  it('rejects tampered ciphertext (GCM authentication)', () => {
    const enc = encryptMfaSecret('JBSWY3DPEHPK3PXP', key);
    const tampered = enc.ciphertext.slice(0, -2) + (enc.ciphertext.endsWith('A') ? 'BB' : 'AA');
    expect(() => decryptMfaSecret(tampered, key)).toThrow();
  });
});
