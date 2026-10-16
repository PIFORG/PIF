export default () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  databaseUrl: process.env.DATABASE_URL,
  logFormat: process.env.LOG_FORMAT ?? (process.env.NODE_ENV === 'production' ? 'json' : 'pretty'),
  // On by default outside production; production must opt in explicitly.
  swaggerEnabled:
    (process.env.SWAGGER_ENABLED ?? (process.env.NODE_ENV === 'production' ? 'false' : 'true'))
      .toLowerCase() === 'true',
  app: {
    name: process.env.APP_NAME ?? 'Market Trading Room Simulator',
    frontendUrl: process.env.APP_FRONTEND_URL ?? 'http://localhost:3000',
    apiUrl: process.env.APP_API_URL ?? 'http://localhost:3001',
    apiPrefix: process.env.API_PREFIX ?? 'api',
    trustProxy: process.env.TRUST_PROXY ?? 'false',
    corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    accessSecretPrevious: process.env.JWT_ACCESS_SECRET_PREVIOUS || undefined,
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    issuer: process.env.JWT_ISSUER ?? 'mtrs-api',
    audience: process.env.JWT_AUDIENCE ?? 'mtrs-web',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  },
  auth: {
    tokenPepper: process.env.AUTH_TOKEN_PEPPER,
    emailCooldownSeconds: parseInt(process.env.AUTH_EMAIL_COOLDOWN_SECONDS ?? '60', 10),
    emailVerificationExpiresMinutes: parseInt(
      process.env.EMAIL_VERIFICATION_TOKEN_EXPIRES_IN_MINUTES ?? '60',
      10,
    ),
    passwordResetExpiresMinutes: parseInt(
      process.env.PASSWORD_RESET_TOKEN_EXPIRES_IN_MINUTES ?? '30',
      10,
    ),
    mfaChallengeExpiresMinutes: parseInt(
      process.env.MFA_LOGIN_CHALLENGE_EXPIRES_IN_MINUTES ?? '5',
      10,
    ),
    emailChangeExpiresMinutes: parseInt(
      process.env.EMAIL_CHANGE_TOKEN_EXPIRES_IN_MINUTES ?? '60',
      10,
    ),
    maxSessions: parseInt(process.env.AUTH_MAX_SESSIONS ?? '8', 10),
    rateLimitTtl: parseInt(process.env.AUTH_RATE_LIMIT_TTL_SECONDS ?? '60', 10),
    rateLimitLimit: parseInt(process.env.AUTH_RATE_LIMIT_LIMIT ?? '20', 10),
    loginMaxFailures: parseInt(process.env.AUTH_LOGIN_MAX_FAILURES ?? '8', 10),
    loginLockoutMinutes: parseInt(process.env.AUTH_LOGIN_LOCKOUT_MINUTES ?? '15', 10),
    ipHashPepper: process.env.AUTH_IP_HASH_PEPPER,
    tokenRetentionDays: parseInt(process.env.AUTH_TOKEN_RETENTION_DAYS ?? '30', 10),
    auditRetentionDays: parseInt(process.env.AUTH_AUDIT_RETENTION_DAYS ?? '365', 10),
    pendingDeletionDays: parseInt(process.env.ACCOUNT_PENDING_DELETION_DAYS ?? '30', 10),
    // RECOMMENDED policy, not a client requirement: on by default in production only.
    adminMfaRequired:
      (process.env.AUTH_ADMIN_MFA_REQUIRED ??
        (process.env.NODE_ENV === 'production' ? 'true' : 'false')).toLowerCase() === 'true',
  },
  mfa: {
    encryptionKey: process.env.MFA_ENCRYPTION_KEY,
  },
  cookie: {
    name: process.env.AUTH_REFRESH_COOKIE_NAME ?? 'mtrs_refresh',
    secure: (process.env.AUTH_COOKIE_SECURE ?? 'false').toLowerCase() === 'true',
    sameSite: (process.env.AUTH_COOKIE_SAME_SITE ?? 'lax') as 'strict' | 'lax' | 'none',
    path: process.env.AUTH_COOKIE_PATH ?? '/api/auth',
    domain: process.env.AUTH_COOKIE_DOMAIN || undefined,
  },
  mail: {
    // Unset means real SMTP; the local preview inbox is strictly opt-in and rejected in production.
    transport: (process.env.MAIL_TRANSPORT || 'smtp').toLowerCase() as 'preview' | 'smtp',
    previewDir: process.env.MAIL_PREVIEW_DIR || '.mail-preview',
    replyTo: process.env.MAIL_REPLY_TO || undefined,
  },
  smtp: {
    host: process.env.SMTP_HOST ?? 'localhost',
    port: parseInt(process.env.SMTP_PORT ?? '1025', 10),
    secure: (process.env.SMTP_SECURE ?? 'false').toLowerCase() === 'true',
    requireTls:
      (process.env.SMTP_REQUIRE_TLS ?? (process.env.NODE_ENV === 'production' ? 'true' : 'false'))
        .toLowerCase() === 'true',
    user: process.env.SMTP_USER || undefined,
    pass: process.env.SMTP_PASS || undefined,
    from: process.env.EMAIL_FROM ?? 'noreply@localhost',
    supportUrl: process.env.EMAIL_SUPPORT_URL || undefined,
  },
});
