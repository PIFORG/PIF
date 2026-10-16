import {
  hashPassword,
  hashSecret,
  validatePasswordPolicy,
  verifyPassword,
} from './password.util';
import { generateOpaqueToken, hashOpaqueToken } from './token.util';
import { decryptMfaSecret, encryptMfaSecret } from './mfa-crypto.util';

describe('password policy', () => {
  it.each(['nasma@2026', 'abc12#xy', 'Copper-Lantern-Harbor-77', 'café 2026 €', 'E2eUniqueStrongPass!99'])(
    'accepts %p',
    (pw) => {
      expect(validatePasswordPolicy(pw).errors).toEqual([]);
    },
  );

  it('rejects passwords shorter than 8 characters', () => {
    expect(validatePasswordPolicy('ab1@xyz').errors).toEqual(['Password must be at least 8 characters']);
  });

  it('rejects passwords longer than 128 code points', () => {
    expect(validatePasswordPolicy(`a1@${'a'.repeat(126)}`).valid).toBe(false);
  });

  it('counts Unicode code points, not UTF-16 units', () => {
    // 6 emoji are 12 UTF-16 units but only 6 code points
    expect(validatePasswordPolicy('a1🔒🌍📈📉💹🏦').valid).toBe(true);
    expect(validatePasswordPolicy('a1🔒🌍📈📉💹').valid).toBe(false);
  });

  it.each([
    ['nasma2026', 'Password must contain a symbol'],
    ['nasma@abc', 'Password must contain a number'],
    ['2026@2026', 'Password must contain a letter'],
    ['nasma 2026', 'Password must contain a symbol'],
  ])('rejects %p', (pw, error) => {
    expect(validatePasswordPolicy(pw).errors).toEqual([error]);
  });
});

describe('argon2id hashing', () => {
  it('hashes and verifies', async () => {
    const password = 'test-password-2026';
    const hash = await hashPassword(password);
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hash, password)).toBe(true);
    expect(await verifyPassword(hash, 'wrong password here!!')).toBe(false);
  });

  it('hashes short secrets without policy', async () => {
    const hash = await hashSecret('ABCD1234EF');
    expect(await verifyPassword(hash, 'ABCD1234EF')).toBe(true);
  });
});

describe('opaque tokens', () => {
  it('generates 64 hex chars and hashes with pepper', () => {
    const token = generateOpaqueToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    const a = hashOpaqueToken(token, 'pepper-pepper-pepper-pepper-pepper-xx');
    const b = hashOpaqueToken(token, 'pepper-pepper-pepper-pepper-pepper-xx');
    expect(a).toEqual(b);
    expect(a).not.toEqual(token);
  });
});

describe('mfa encryption', () => {
  const key = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  it('round-trips secrets', () => {
    const { ciphertext, keyVersion } = encryptMfaSecret('BASE32SECRET', key);
    expect(keyVersion).toBe(1);
    expect(decryptMfaSecret(ciphertext, key)).toBe('BASE32SECRET');
  });
});
