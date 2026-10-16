export const API_TAGS = {
  authentication: 'Authentication',
  userManagement: 'User Management',
  accountSecurity: 'Account Security',
  sessions: 'Sessions',
  mfa: 'Multi-Factor Authentication',
  administration: 'Administration',
  auditLogs: 'Audit Logs',
  health: 'System Health',
} as const;

/** Swagger lists sections in this order. */
export const API_TAG_DESCRIPTIONS: ReadonlyArray<[string, string]> = [
  [API_TAGS.authentication, 'Registration, email verification, sign-in, token refresh and password recovery'],
  [API_TAGS.userManagement, 'Profile, preferences, dashboard context and account lifecycle of the signed-in user'],
  [API_TAGS.accountSecurity, 'Password and email address changes'],
  [API_TAGS.sessions, 'Active devices and session revocation'],
  [API_TAGS.mfa, 'Authenticator app enrollment, sign-in verification and recovery codes'],
  [API_TAGS.administration, 'User oversight, account status and role management (administrators only)'],
  [API_TAGS.auditLogs, 'Security and administration event history (administrators only)'],
  [API_TAGS.health, 'Service and database availability'],
];
