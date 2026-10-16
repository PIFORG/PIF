import { describe, expect, it } from 'vitest';
import { changePasswordSchema, registerSchema, resetPasswordSchema } from './schemas';

const base = {
  firstName: 'Ada',
  lastName: 'Trader',
  email: 'ada@example.com',
};

function passwordErrors(pw: string): string[] {
  const r = resetPasswordSchema.safeParse({ password: pw, confirmPassword: pw });
  return r.success ? [] : r.error.issues.map((issue) => issue.message);
}

describe('client password policy mirrors the API (8–128, letter + number + symbol)', () => {
  it('accepts a short password with a letter, a number and a symbol', () => {
    const pw = 'nasma@2026';
    expect(registerSchema.safeParse({ ...base, password: pw, confirmPassword: pw }).success).toBe(true);
  });

  it('accepts Unicode letters and symbols', () => {
    expect(passwordErrors('café 2026 €')).toEqual([]);
  });

  it('rejects passwords shorter than 8 characters', () => {
    expect(passwordErrors('ab1@xyz')).toEqual(['Password must be at least 8 characters']);
  });

  it('rejects passwords longer than 128 characters', () => {
    expect(passwordErrors(`a1@${'a'.repeat(126)}`)).toEqual(['Password is too long']);
  });

  it.each([
    ['nasma2026', 'Password must contain a symbol'],
    ['nasma@abc', 'Password must contain a number'],
    ['2026@2026', 'Password must contain a letter'],
  ])('rejects %p', (pw, error) => {
    expect(passwordErrors(pw)).toEqual([error]);
  });

  it('requires matching confirmation', () => {
    const r = changePasswordSchema.safeParse({
      currentPassword: 'x',
      newPassword: 'nasma@2026',
      confirmPassword: 'nasma@2027',
    });
    expect(r.success).toBe(false);
  });

  it('rejects blank names after trimming', () => {
    const pw = 'nasma@2026';
    const r = registerSchema.safeParse({ ...base, firstName: '   ', password: pw, confirmPassword: pw });
    expect(r.success).toBe(false);
  });
});
