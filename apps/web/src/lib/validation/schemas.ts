import { z } from 'zod';

/** Mirrors the API: 8–128 characters with at least one letter, one number and one symbol. */
export const PASSWORD_HINT = 'At least 8 characters, including a letter, a number and a symbol.';

const passwordRules = z
  .string()
  .refine((value) => [...value].length >= 8, 'Password must be at least 8 characters')
  .refine((value) => [...value].length <= 128, 'Password is too long')
  .refine((value) => /\p{L}/u.test(value), 'Password must contain a letter')
  .refine((value) => /\p{N}/u.test(value), 'Password must contain a number')
  .refine((value) => /[^\p{L}\p{N}\s]/u.test(value), 'Password must contain a symbol');

export const registerSchema = z
  .object({
    firstName: z.string().trim().min(1, 'First name is required').max(80),
    lastName: z.string().trim().min(1, 'Last name is required').max(80),
    email: z.string().trim().email('Enter a valid email').max(254),
    password: passwordRules,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

export const mfaCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .min(6, 'Enter a 6-digit code or recovery code')
    .max(32),
});

export const emailOnlySchema = z.object({
  email: z.string().trim().email('Enter a valid email'),
});

export const resetPasswordSchema = z
  .object({
    password: passwordRules,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

/** Must match the API's closed sets (apps/api/src/auth/dto/auth.dto.ts). */
export const CHART_THEMES = ['trading_desk', 'light', 'dark'] as const;
export const TRAINING_DIFFICULTIES = ['adaptive', 'beginner', 'intermediate', 'advanced'] as const;

export const profileSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  experienceLevel: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']),
  preferredCurrency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, 'Choose a 3-letter currency code'),
  timezone: z.string().trim().min(1, 'Choose a time zone').max(64),
  chartTheme: z.enum(CHART_THEMES),
  trainingDifficulty: z.enum(TRAINING_DIFFICULTIES),
  notifyEmailSecurity: z.boolean(),
  notifyMarketDigest: z.boolean(),
  reduceMotion: z.boolean(),
  highContrast: z.boolean(),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: passwordRules,
    confirmPassword: z.string(),
    totpCode: z.string().optional(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export const emailChangeSchema = z.object({
  newEmail: z.string().trim().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
  totpCode: z.string().optional(),
});

export const passwordConfirmSchema = z.object({
  password: z.string().min(1, 'Password is required'),
  totpCode: z.string().optional(),
});

export type LoginValues = z.infer<typeof loginSchema>;
export type RegisterValues = z.infer<typeof registerSchema>;
export type ProfileValues = z.infer<typeof profileSchema>;
export type ChangePasswordValues = z.infer<typeof changePasswordSchema>;
export type EmailChangeValues = z.infer<typeof emailChangeSchema>;
export type PasswordConfirmValues = z.infer<typeof passwordConfirmSchema>;

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
  const labels = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong', 'Excellent'];
  return { score, label: labels[score] ?? 'Fair' };
}
