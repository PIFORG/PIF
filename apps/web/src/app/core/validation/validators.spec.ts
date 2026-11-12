import {
  passwordStrength,
  validateChangePassword,
  validateEmailChange,
  validateEmailOnly,
  validateLogin,
  validateMfaCode,
  validateMfaEnableCode,
  validateMfaSetup,
  validateNewPassword,
  validateProfile,
  validateRegister,
  validateResetPassword,
  type ProfileValues,
} from './validators';

// Expected messages were produced by zod 3.25.76 with the schemas of apps/web/src/lib/validation/schemas.ts.
describe('form validation parity with the Next.js zod schemas', () => {
  it('validates the sign-in form like loginSchema', () => {
    expect(validateLogin({ email: '', password: '' }).errors).toEqual({
      email: 'Saisissez une adresse courriel valide',
      password: 'Le mot de passe est obligatoire',
    });
    expect(validateLogin({ email: '  ada@example.com ', password: 'x' })).toEqual({
      values: { email: 'ada@example.com', password: 'x' },
      errors: {},
    });
  });

  it.each([
    ['a@b.co', true],
    ['a@b', false],
    ['a.b@c.d', false],
    ['user+x@ex-ample.com', true],
    ['é@x.com', false],
    ['a@b.c', false],
    ['.a@b.co', false],
    ['a..b@c.co', false],
  ])('accepts %s as an email: %s (zod 3 pattern)', (email, valid) => {
    expect(!validateLogin({ email, password: 'x' }).errors.email).toBe(valid);
  });

  it('validates the MFA code like mfaCodeSchema', () => {
    expect(validateMfaCode(' 12345 ').error).toBe('Saisissez un code à 6 chiffres ou un code de récupération');
    expect(validateMfaCode('x'.repeat(40)).error).toBe('La chaîne doit contenir au plus 32 caractère(s)');
    expect(validateMfaCode(' 123456 ')).toEqual({ code: '123456' });
  });

  const valid: ProfileValues = {
    firstName: 'Ada',
    lastName: 'Lovelace',
    experienceLevel: 'BEGINNER',
    preferredCurrency: 'eur',
    timezone: 'Africa/Tunis',
    chartTheme: 'trading_desk',
    trainingDifficulty: 'adaptive',
    notifyEmailSecurity: true,
    notifyMarketDigest: false,
    reduceMotion: false,
    highContrast: false,
  };

  it('validates the profile form like profileSchema', () => {
    expect(validateProfile(valid).errors).toEqual({});
    expect(validateProfile({ ...valid, firstName: '   ', lastName: 'y'.repeat(81), preferredCurrency: 'x' }).errors).toEqual({
      firstName: 'La chaîne doit contenir au moins 1 caractère(s)',
      lastName: 'La chaîne doit contenir au plus 80 caractère(s)',
      preferredCurrency: 'Choisissez un code devise à 3 lettres',
    });
    expect(validateProfile({ ...valid, experienceLevel: 'Z' }).errors.experienceLevel).toBe(
      "Valeur d'énumération invalide. Attendu 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED', reçu 'Z'",
    );
  });

  it.each([
    ['', 'Le mot de passe doit contenir au moins 8 caractères'],
    ['😀😀😀😀😀😀😀', 'Le mot de passe doit contenir au moins 8 caractères'],
    ['a1!'.repeat(43), 'Le mot de passe est trop long'],
    ['12345678!', 'Le mot de passe doit contenir une lettre'],
    ['abcdefgh!', 'Le mot de passe doit contenir un chiffre'],
    ['abcdefg 1', 'Le mot de passe doit contenir un symbole'],
    ['Ünïcode1€', undefined],
  ])('applies passwordRules to %j', (password, message) => {
    expect(validateNewPassword(password)).toBe(message);
  });

  it('validates the registration form like registerSchema, including the confirmation refinement', () => {
    expect(validateRegister({ firstName: ' ', lastName: '', email: 'x', password: '', confirmPassword: 'y' }).errors).toEqual({
      firstName: 'Le prénom est obligatoire',
      lastName: 'Le nom est obligatoire',
      email: 'Saisissez une adresse courriel valide',
      password: 'Le mot de passe doit contenir au moins 8 caractères',
      confirmPassword: 'Les mots de passe ne correspondent pas',
    });
    expect(
      validateRegister({
        firstName: ' Ada ',
        lastName: 'L'.repeat(81),
        email: ` ${'a'.repeat(250)}@b.co `,
        password: 'Engine#1843',
        confirmPassword: 'Engine#1843',
      }),
    ).toEqual({
      values: {
        firstName: 'Ada',
        lastName: 'L'.repeat(81),
        email: `${'a'.repeat(250)}@b.co`,
        password: 'Engine#1843',
        confirmPassword: 'Engine#1843',
      },
      errors: {
        lastName: 'La chaîne doit contenir au plus 80 caractère(s)',
        email: 'La chaîne doit contenir au plus 254 caractère(s)',
      },
    });
  });

  it('validates the e-mail-only, reset and change-password forms', () => {
    expect(validateEmailOnly({ email: ' ada@example.com ' })).toEqual({ values: { email: 'ada@example.com' }, errors: {} });
    expect(validateEmailOnly({ email: 'ada' }).errors).toEqual({ email: 'Saisissez une adresse courriel valide' });
    expect(validateResetPassword({ password: 'Engine#1843', confirmPassword: 'Engine#1844' }).errors).toEqual({
      confirmPassword: 'Les mots de passe ne correspondent pas',
    });
    expect(
      validateChangePassword({ currentPassword: '', newPassword: 'short', confirmPassword: 'short', totpCode: '' }).errors,
    ).toEqual({
      currentPassword: 'Le mot de passe actuel est obligatoire',
      newPassword: 'Le mot de passe doit contenir au moins 8 caractères',
    });
  });

  it('validates the email-change and MFA forms', () => {
    expect(validateEmailChange({ newEmail: ' new@example.com ', password: '', totpCode: '' })).toEqual({
      values: { newEmail: 'new@example.com', password: '', totpCode: '' },
      errors: { password: 'Le mot de passe est obligatoire' },
    });
    expect(validateMfaSetup({ password: '' }).errors).toEqual({ password: 'Le mot de passe est obligatoire' });
    expect(validateMfaEnableCode({ code: '12a456' }).errors).toEqual({ code: "Saisissez le code à 6 chiffres de l'authentificateur" });
    expect(validateMfaEnableCode({ code: ' 123456 ' })).toEqual({ values: { code: '123456' }, errors: {} });
  });

  it('rates password strength like the Next.js hint', () => {
    expect(passwordStrength('')).toEqual({ score: 0, label: 'Très faible' });
    expect(passwordStrength('abcdefgh')).toEqual({ score: 2, label: 'Moyen' });
    expect(passwordStrength('Correct horse 9')).toEqual({ score: 5, label: 'Excellent' });
  });
});
