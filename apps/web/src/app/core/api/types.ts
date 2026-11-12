export type UserRole = 'INVESTOR' | 'ADMIN';

export type ExperienceLevel = 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';

export type UserStatus = 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED' | 'PENDING_DELETION';

export interface UserPreferences {
  preferredCurrency: string;
  timezone: string;
  chartTheme: string;
  notifyEmailSecurity: boolean;
  notifyMarketDigest: boolean;
  trainingDifficulty: string;
  reduceMotion: boolean;
  highContrast: boolean;
}

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  experienceLevel: ExperienceLevel;
  emailVerified: boolean;
  status: UserStatus;
  mfaEnabled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  preferences?: UserPreferences | null;
}

export interface AuthTokensResponse {
  accessToken: string;
  user: User;
}

export interface MfaRequiredResponse {
  mfaRequired: true;
  mfaChallengeToken: string;
  errorCode?: string | null;
}

export type LoginResponse = AuthTokensResponse | MfaRequiredResponse;

export interface MessageResponse {
  message: string;
  errorCode?: string | null;
}

export interface AuthSession {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  userAgent: string | null;
  deviceLabel: string | null;
  current?: boolean;
}

export interface MfaSetupResponse {
  secret: string;
  otpauth: string;
  expiresInMinutes?: number;
}

export interface MfaEnableResponse {
  recoveryCodes: string[];
}

export interface MfaStatusResponse {
  mfaEnabled: boolean;
  mfaVerifiedAt: string | null;
  remainingRecoveryCodes: number;
}

export interface DashboardModule {
  id: string;
  label: string;
  permitted: boolean;
  available: boolean;
}

export interface DashboardContext {
  user: User;
  role: UserRole;
  experienceLevel: ExperienceLevel;
  experienceLevelNotice: string;
  capabilities: Record<string, boolean>;
  requiredActions: string[];
  modules: DashboardModule[];
}

export interface AdminAuditEvent {
  id: string;
  eventType: string;
  outcome: string;
  actorUserId: string | null;
  subjectUserId: string | null;
  correlationId: string | null;
  createdAt: string;
  context: Record<string, unknown> | null;
}

export interface PaginatedAuditEvents {
  items: AdminAuditEvent[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminOverview {
  users: {
    total: number;
    active: number;
    pending: number;
    suspended: number;
    deactivated: number;
    verified: number;
    mfaEnabled: number;
  };
  recentEvents: {
    id: string;
    eventType: string;
    outcome: string;
    createdAt: string;
  }[];
  eventTotals: {
    windowDays: number;
    items: { eventType: string; outcome: string; count: number }[];
  };
}

export interface AdminUserListItem {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  status: UserStatus;
  emailVerified: boolean;
  mfaEnabled: boolean;
  experienceLevel: ExperienceLevel;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface PaginatedUsers {
  items: AdminUserListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminUserDetail {
  user: User;
  security: {
    locked: boolean;
    activeSessions: number;
  };
  auditSummary: {
    id: string;
    eventType: string;
    outcome: string;
    createdAt: string;
    byAdministrator: boolean;
  }[];
}

export interface ApiErrorBody {
  statusCode?: number;
  message?: string | string[];
  error?: string;
  errorCode?: string;
  code?: string;
  details?: unknown;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    public readonly details?: string[],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function isLoginSuccess(result: LoginResponse): result is AuthTokensResponse {
  return 'accessToken' in result && typeof result.accessToken === 'string';
}

export function isMfaRequired(result: LoginResponse): result is MfaRequiredResponse {
  return 'mfaRequired' in result && result.mfaRequired === true;
}
