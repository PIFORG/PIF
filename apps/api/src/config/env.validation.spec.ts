import 'reflect-metadata';
import { validateEnv } from './env.validation';

const REJECTION = /Unsafe configuration|Environment validation failed/;

const strong = (seed: string) =>
  `${seed}-Zq8vR2mXp4LkT9wB6nYc3HsJ7fDg5aEu`.slice(0, 48);

function baseEnv(overrides: Record<string, string | undefined> = {}): Record<string, unknown> {
  const env: Record<string, string | undefined> = {
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    APP_NAME: 'Market Trading Room Simulator',
    APP_FRONTEND_URL: 'http://localhost:3000',
    APP_API_URL: 'http://localhost:3001',
    API_PREFIX: 'api',
    CORS_ORIGINS: 'http://localhost:3000',
    JWT_ACCESS_SECRET: 'dev-access-secret-mtrs-local-only-32chars',
    JWT_ACCESS_EXPIRES_IN: '15m',
    JWT_ISSUER: 'mtrs-api',
    JWT_AUDIENCE: 'mtrs-web',
    JWT_REFRESH_EXPIRES_IN: '7d',
    AUTH_TOKEN_PEPPER: 'dev-token-pepper-mtrs-local-only-32chars',
    AUTH_EMAIL_COOLDOWN_SECONDS: '60',
    EMAIL_VERIFICATION_TOKEN_EXPIRES_IN_MINUTES: '60',
    PASSWORD_RESET_TOKEN_EXPIRES_IN_MINUTES: '30',
    MFA_LOGIN_CHALLENGE_EXPIRES_IN_MINUTES: '5',
    EMAIL_CHANGE_TOKEN_EXPIRES_IN_MINUTES: '60',
    AUTH_MAX_SESSIONS: '8',
    AUTH_RATE_LIMIT_TTL_SECONDS: '60',
    AUTH_RATE_LIMIT_LIMIT: '20',
    AUTH_LOGIN_MAX_FAILURES: '8',
    AUTH_LOGIN_LOCKOUT_MINUTES: '15',
    AUTH_IP_HASH_PEPPER: 'dev-ip-hash-pepper-mtrs-local-32chars',
    MFA_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    AUTH_REFRESH_COOKIE_NAME: 'mtrs_refresh',
    AUTH_COOKIE_SECURE: 'false',
    AUTH_COOKIE_SAME_SITE: 'lax',
    AUTH_COOKIE_PATH: '/api/auth',
    SMTP_HOST: 'localhost',
    SMTP_PORT: '1025',
    SMTP_SECURE: 'false',
    EMAIL_FROM: 'MTRS <noreply@localhost>',
    AUTH_TOKEN_RETENTION_DAYS: '30',
    AUTH_AUDIT_RETENTION_DAYS: '365',
    ACCOUNT_PENDING_DELETION_DAYS: '30',
    ...overrides,
  };
  return Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined));
}

function productionEnv(overrides: Record<string, string | undefined> = {}) {
  return baseEnv({
    NODE_ENV: 'production',
    APP_FRONTEND_URL: 'https://app.mtrs.example',
    CORS_ORIGINS: 'https://app.mtrs.example',
    JWT_ACCESS_SECRET: strong('a'),
    AUTH_TOKEN_PEPPER: strong('b'),
    AUTH_IP_HASH_PEPPER: strong('c'),
    MFA_ENCRYPTION_KEY: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    AUTH_COOKIE_SECURE: 'true',
    MAIL_TRANSPORT: 'smtp',
    SMTP_HOST: 'smtp.relay-provider.net',
    SMTP_PORT: '587',
    SMTP_SECURE: 'false',
    SMTP_USER: 'relay-user',
    SMTP_PASS: 'fixture-only-not-a-credential',
    EMAIL_FROM: 'MTRS <no-reply@mtrs-app.com>',
    ...overrides,
  });
}

describe('validateEnv', () => {
  it('accepts the local development template', () => {
    expect(() => validateEnv(baseEnv())).not.toThrow();
  });

  it('accepts a hardened production configuration', () => {
    expect(() => validateEnv(productionEnv())).not.toThrow();
  });

  it.each([
    ['malformed access TTL', { JWT_ACCESS_EXPIRES_IN: '15 minutes' }],
    ['malformed refresh TTL', { JWT_REFRESH_EXPIRES_IN: '7' }],
    ['refresh shorter than access', { JWT_ACCESS_EXPIRES_IN: '2h', JWT_REFRESH_EXPIRES_IN: '1h' }],
    ['wildcard CORS', { CORS_ORIGINS: '*' }],
    ['CORS with path', { CORS_ORIGINS: 'http://localhost:3000/app' }],
    ['frontend not in CORS allowlist', { APP_FRONTEND_URL: 'http://localhost:4000' }],
    ['SameSite=None without Secure', { AUTH_COOKIE_SAME_SITE: 'none' }],
    ['cookie path not scoped to auth routes', { AUTH_COOKIE_PATH: '/' }],
    ['non-boolean security flag', { AUTH_COOKIE_SECURE: 'yes' }],
    ['trust-all proxy', { TRUST_PROXY: 'true' }],
  ])('rejects %s in any environment', (_label, overrides) => {
    expect(() => validateEnv(baseEnv(overrides))).toThrow(REJECTION);
  });

  it.each([
    ['placeholder JWT secret', { JWT_ACCESS_SECRET: 'change-me-to-a-long-random-access-secret-32chars-min' }],
    ['placeholder previous JWT secret', { JWT_ACCESS_SECRET_PREVIOUS: 'change-me-previous-secret-value-32chars' }],
    ['reused secret across purposes', { AUTH_TOKEN_PEPPER: strong('a') }],
    ['default MFA key', { MFA_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' }],
    ['low-entropy MFA key', { MFA_ENCRYPTION_KEY: 'a'.repeat(64) }],
    ['insecure cookie', { AUTH_COOKIE_SECURE: 'false' }],
    ['http CORS origin', { CORS_ORIGINS: 'http://app.mtrs.example', APP_FRONTEND_URL: 'http://app.mtrs.example' }],
    ['long-lived access token', { JWT_ACCESS_EXPIRES_IN: '12h' }],
    ['the local preview mail transport', { MAIL_TRANSPORT: 'preview' }],
    ['a loopback SMTP relay', { SMTP_HOST: 'localhost' }],
    ['a loopback SMTP relay by IP', { SMTP_HOST: '127.0.0.1' }],
    ['a localhost sender', { EMAIL_FROM: 'MTRS <noreply@localhost>' }],
    ['a reserved example sender domain', { EMAIL_FROM: 'no-reply@mtrs.example' }],
    ['plaintext SMTP without TLS', { SMTP_REQUIRE_TLS: 'false' }],
    ['an SMTP user without a password', { SMTP_PASS: undefined }],
  ])('rejects %s in production', (_label, overrides) => {
    expect(() => validateEnv(productionEnv(overrides))).toThrow(REJECTION);
  });

  it('accepts the preview mail transport outside production', () => {
    expect(() => validateEnv(baseEnv({ MAIL_TRANSPORT: 'preview' }))).not.toThrow();
  });

  it('rejects an unknown mail transport', () => {
    expect(() => validateEnv(baseEnv({ MAIL_TRANSPORT: 'sendgrid' }))).toThrow(REJECTION);
  });
});
