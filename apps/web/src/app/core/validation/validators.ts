/**
 * Field rules of apps/web/src/lib/validation/schemas.ts (zod 3.25), returning the same first message zod
 * reports for each field. Values are trimmed first where the zod schema calls .trim().
 */

/** zod 3 `z.string().email()` pattern. */
const ZOD_EMAIL = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9-]*\.)+[A-Z]{2,}$/i;

export const CHART_THEMES = ['trading_desk', 'light', 'dark'] as const;
export const TRAINING_DIFFICULTIES = ['adaptive', 'beginner', 'intermediate', 'advanced'] as const;
export const EXPERIENCE_LEVELS = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] as const;

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

function minMessage(n: number): string {
  return `La chaîne doit contenir au moins ${n} caractère(s)`;
}

function maxMessage(n: number): string {
  return `La chaîne doit contenir au plus ${n} caractère(s)`;
}

function enumMessage(options: readonly string[], received: string): string {
  return `Valeur d'énumération invalide. Attendu ${options.map((o) => `'${o}'`).join(' | ')}, reçu '${received}'`;
}

export interface LoginValues {
  email: string;
  password: string;
}

/** loginSchema: email trim().email(); password min(1). */
export function validateLogin(raw: LoginValues): { values: LoginValues; errors: FieldErrors<keyof LoginValues> } {
  const email = raw.email.trim();
  const errors: FieldErrors<keyof LoginValues> = {};
  if (!ZOD_EMAIL.test(email)) errors.email = 'Saisissez une adresse courriel valide';
  if (raw.password.length < 1) errors.password = 'Le mot de passe est obligatoire';
  return { values: { email, password: raw.password }, errors };
}

/** mfaCodeSchema: code trim().min(6).max(32). */
export function validateMfaCode(raw: string): { code: string; error?: string } {
  const code = raw.trim();
  if (code.length < 6) return { code, error: 'Saisissez un code à 6 chiffres ou un code de récupération' };
  if (code.length > 32) return { code, error: maxMessage(32) };
  return { code };
}

export interface ProfileValues {
  firstName: string;
  lastName: string;
  experienceLevel: string;
  preferredCurrency: string;
  timezone: string;
  chartTheme: string;
  trainingDifficulty: string;
  notifyEmailSecurity: boolean;
  notifyMarketDigest: boolean;
  reduceMotion: boolean;
  highContrast: boolean;
}

/** profileSchema of the settings profile page. */
export function validateProfile(raw: ProfileValues): {
  values: ProfileValues;
  errors: FieldErrors<keyof ProfileValues>;
} {
  const values: ProfileValues = {
    ...raw,
    firstName: raw.firstName.trim(),
    lastName: raw.lastName.trim(),
    preferredCurrency: raw.preferredCurrency.trim(),
    timezone: raw.timezone.trim(),
  };
  const errors: FieldErrors<keyof ProfileValues> = {};
  const length = (s: string) => s.length;

  if (length(values.firstName) < 1) errors.firstName = minMessage(1);
  else if (length(values.firstName) > 80) errors.firstName = maxMessage(80);
  if (length(values.lastName) < 1) errors.lastName = minMessage(1);
  else if (length(values.lastName) > 80) errors.lastName = maxMessage(80);
  if (!(EXPERIENCE_LEVELS as readonly string[]).includes(values.experienceLevel)) {
    errors.experienceLevel = enumMessage(EXPERIENCE_LEVELS, values.experienceLevel);
  }
  if (!/^[A-Za-z]{3}$/.test(values.preferredCurrency)) errors.preferredCurrency = 'Choisissez un code devise à 3 lettres';
  if (length(values.timezone) < 1) errors.timezone = 'Choisissez un fuseau horaire';
  else if (length(values.timezone) > 64) errors.timezone = maxMessage(64);
  if (!(CHART_THEMES as readonly string[]).includes(values.chartTheme)) {
    errors.chartTheme = enumMessage(CHART_THEMES, values.chartTheme);
  }
  if (!(TRAINING_DIFFICULTIES as readonly string[]).includes(values.trainingDifficulty)) {
    errors.trainingDifficulty = enumMessage(TRAINING_DIFFICULTIES, values.trainingDifficulty);
  }
  return { values, errors };
}

export function hasErrors(errors: Record<string, string | undefined>): boolean {
  return Object.values(errors).some((e) => !!e);
}

/** Mirrors the API: 8–128 characters with at least one letter, one number and one symbol. */
export const PASSWORD_HINT = 'Au moins 8 caractères, dont une lettre, un chiffre et un symbole.';

/** passwordRules: the first failing refinement, in declaration order (lengths count code points). */
export function validateNewPassword(value: string): string | undefined {
  const length = [...value].length;
  if (length < 8) return 'Le mot de passe doit contenir au moins 8 caractères';
  if (length > 128) return 'Le mot de passe est trop long';
  if (!/\p{L}/u.test(value)) return 'Le mot de passe doit contenir une lettre';
  if (!/\p{N}/u.test(value)) return 'Le mot de passe doit contenir un chiffre';
  if (!/[^\p{L}\p{N}\s]/u.test(value)) return 'Le mot de passe doit contenir un symbole';
  return undefined;
}

const PASSWORDS_DIFFER = 'Les mots de passe ne correspondent pas';

export interface RegisterValues {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  confirmPassword: string;
}

/** registerSchema, including the object-level match refinement on confirmPassword. */
export function validateRegister(raw: RegisterValues): { values: RegisterValues; errors: FieldErrors<keyof RegisterValues> } {
  const values: RegisterValues = {
    ...raw,
    firstName: raw.firstName.trim(),
    lastName: raw.lastName.trim(),
    email: raw.email.trim(),
  };
  const errors: FieldErrors<keyof RegisterValues> = {};
  if (values.firstName.length < 1) errors.firstName = 'Le prénom est obligatoire';
  else if (values.firstName.length > 80) errors.firstName = maxMessage(80);
  if (values.lastName.length < 1) errors.lastName = 'Le nom est obligatoire';
  else if (values.lastName.length > 80) errors.lastName = maxMessage(80);
  if (!ZOD_EMAIL.test(values.email)) errors.email = 'Saisissez une adresse courriel valide';
  else if (values.email.length > 254) errors.email = maxMessage(254);
  errors.password = validateNewPassword(values.password);
  if (values.password !== values.confirmPassword) errors.confirmPassword = PASSWORDS_DIFFER;
  return { values, errors: compact(errors) };
}

export interface EmailOnlyValues {
  email: string;
}

/** emailOnlySchema (forgot-password, resend verification). */
export function validateEmailOnly(raw: EmailOnlyValues): { values: EmailOnlyValues; errors: FieldErrors<keyof EmailOnlyValues> } {
  const email = raw.email.trim();
  return { values: { email }, errors: ZOD_EMAIL.test(email) ? {} : { email: 'Saisissez une adresse courriel valide' } };
}

export interface ResetPasswordValues {
  password: string;
  confirmPassword: string;
}

/** resetPasswordSchema. */
export function validateResetPassword(raw: ResetPasswordValues): {
  values: ResetPasswordValues;
  errors: FieldErrors<keyof ResetPasswordValues>;
} {
  const errors: FieldErrors<keyof ResetPasswordValues> = { password: validateNewPassword(raw.password) };
  if (raw.password !== raw.confirmPassword) errors.confirmPassword = PASSWORDS_DIFFER;
  return { values: { ...raw }, errors: compact(errors) };
}

export interface ChangePasswordValues {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
  totpCode: string;
}

/** changePasswordSchema; the authenticator code is checked by the page only when MFA is on. */
export function validateChangePassword(raw: ChangePasswordValues): {
  values: ChangePasswordValues;
  errors: FieldErrors<keyof ChangePasswordValues>;
} {
  const errors: FieldErrors<keyof ChangePasswordValues> = {};
  if (raw.currentPassword.length < 1) errors.currentPassword = 'Le mot de passe actuel est obligatoire';
  errors.newPassword = validateNewPassword(raw.newPassword);
  if (raw.newPassword !== raw.confirmPassword) errors.confirmPassword = PASSWORDS_DIFFER;
  return { values: { ...raw }, errors: compact(errors) };
}

export interface EmailChangeValues {
  newEmail: string;
  password: string;
  totpCode: string;
}

/** emailChangeSchema. */
export function validateEmailChange(raw: EmailChangeValues): {
  values: EmailChangeValues;
  errors: FieldErrors<keyof EmailChangeValues>;
} {
  const values: EmailChangeValues = { ...raw, newEmail: raw.newEmail.trim() };
  const errors: FieldErrors<keyof EmailChangeValues> = {};
  if (!ZOD_EMAIL.test(values.newEmail)) errors.newEmail = 'Saisissez une adresse courriel valide';
  if (raw.password.length < 1) errors.password = 'Le mot de passe est obligatoire';
  return { values, errors };
}

/** MfaEnrollment setupSchema: password min(1). */
export function validateMfaSetup(raw: { password: string }): {
  values: { password: string };
  errors: FieldErrors<'password'>;
} {
  return { values: { ...raw }, errors: raw.password.length < 1 ? { password: 'Le mot de passe est obligatoire' } : {} };
}

/** MfaEnrollment confirmSchema: code trim().regex(/^\d{6}$/). */
export function validateMfaEnableCode(raw: { code: string }): { values: { code: string }; errors: FieldErrors<'code'> } {
  const code = raw.code.trim();
  return {
    values: { code },
    errors: /^\d{6}$/.test(code) ? {} : { code: "Saisissez le code à 6 chiffres de l'authentificateur" },
  };
}

/** Lightweight UX hint only — server enforces the real policy. */
export function passwordStrength(password: string): { score: number; label: string } {
  const length = [...password].length;
  let score = 0;
  if (length >= 8) score += 2;
  if (length >= 14) score += 1;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score += 1;
  if (/\d/.test(password) || /[^\w\s]/.test(password)) score += 1;
  if (password.includes(' ')) score += 1;
  score = Math.min(5, score);
  const labels = ['Très faible', 'Faible', 'Moyen', 'Bon', 'Fort', 'Excellent'];
  return { score, label: labels[score] ?? 'Moyen' };
}

function compact<K extends string>(errors: FieldErrors<K>): FieldErrors<K> {
  return Object.fromEntries(Object.entries(errors).filter(([, message]) => !!message)) as FieldErrors<K>;
}
