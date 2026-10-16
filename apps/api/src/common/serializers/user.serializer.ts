import { ExperienceLevel, User, UserPreferences, UserRole, UserStatus } from '@prisma/client';

export type PublicUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  experienceLevel: ExperienceLevel;
  emailVerified: boolean;
  emailVerifiedAt: string | null;
  status: UserStatus;
  mfaEnabled: boolean;
  mfaVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  lastActiveAt: string | null;
  preferences?: PublicPreferences | null;
};

export type PublicPreferences = {
  preferredCurrency: string;
  timezone: string;
  chartTheme: string;
  notifyEmailSecurity: boolean;
  notifyMarketDigest: boolean;
  trainingDifficulty: string;
  reduceMotion: boolean;
  highContrast: boolean;
};

export function serializePreferences(
  prefs: UserPreferences | null | undefined,
): PublicPreferences | null {
  if (!prefs) {
    return null;
  }
  return {
    preferredCurrency: prefs.preferredCurrency,
    timezone: prefs.timezone,
    chartTheme: prefs.chartTheme,
    notifyEmailSecurity: prefs.notifyEmailSecurity,
    notifyMarketDigest: prefs.notifyMarketDigest,
    trainingDifficulty: prefs.trainingDifficulty,
    reduceMotion: prefs.reduceMotion,
    highContrast: prefs.highContrast,
  };
}
export function serializeUser(
  user: User & { preferences?: UserPreferences | null },
  options?: { includePreferences?: boolean },
): PublicUser {
  const result: PublicUser = {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    experienceLevel: user.experienceLevel,
    emailVerified: user.emailVerified,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
    status: user.status,
    mfaEnabled: user.mfaEnabled,
    mfaVerifiedAt: user.mfaVerifiedAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    lastActiveAt: user.lastActiveAt?.toISOString() ?? null,
  };

  if (options?.includePreferences !== false && user.preferences !== undefined) {
    result.preferences = serializePreferences(user.preferences);
  }

  return result;
}