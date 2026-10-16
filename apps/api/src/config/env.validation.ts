import { plainToInstance } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';
import { parseDurationMs } from '../common/crypto/token.util';

const WEAK_SECRET_MARKERS = [
  'change-me',
  'changeme',
  'secret',
  'password',
  'example',
  'default',
  'test',
  'todo',
];

function looksWeak(value: string): boolean {
  const lower = value.toLowerCase();
  return WEAK_SECRET_MARKERS.some((m) => lower.includes(m));
}

export class EnvironmentVariables {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV!: string;

  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @IsString()
  @IsNotEmpty()
  APP_NAME!: string;

  @IsUrl({ require_tld: false })
  APP_FRONTEND_URL!: string;

  @IsUrl({ require_tld: false })
  APP_API_URL!: string;

  @IsString()
  @IsNotEmpty()
  API_PREFIX!: string;

  @IsString()
  @IsNotEmpty()
  CORS_ORIGINS!: string;

  @IsString()
  @MinLength(32)
  JWT_ACCESS_SECRET!: string;

  @IsOptional()
  @IsString()
  @MinLength(32)
  JWT_ACCESS_SECRET_PREVIOUS?: string;

  @IsString()
  @IsNotEmpty()
  JWT_ACCESS_EXPIRES_IN!: string;

  @IsString()
  @IsNotEmpty()
  JWT_ISSUER!: string;

  @IsString()
  @IsNotEmpty()
  JWT_AUDIENCE!: string;

  @IsString()
  @IsNotEmpty()
  JWT_REFRESH_EXPIRES_IN!: string;

  @IsString()
  @MinLength(32)
  AUTH_TOKEN_PEPPER!: string;

  @IsInt()
  @Min(0)
  AUTH_EMAIL_COOLDOWN_SECONDS!: number;

  @IsInt()
  @Min(1)
  EMAIL_VERIFICATION_TOKEN_EXPIRES_IN_MINUTES!: number;

  @IsInt()
  @Min(1)
  PASSWORD_RESET_TOKEN_EXPIRES_IN_MINUTES!: number;

  @IsInt()
  @Min(1)
  MFA_LOGIN_CHALLENGE_EXPIRES_IN_MINUTES!: number;

  @IsInt()
  @Min(1)
  EMAIL_CHANGE_TOKEN_EXPIRES_IN_MINUTES!: number;

  @IsInt()
  @Min(1)
  @Max(50)
  AUTH_MAX_SESSIONS!: number;

  @IsInt()
  @Min(1)
  AUTH_RATE_LIMIT_TTL_SECONDS!: number;

  @IsInt()
  @Min(1)
  AUTH_RATE_LIMIT_LIMIT!: number;

  @IsInt()
  @Min(1)
  AUTH_LOGIN_MAX_FAILURES!: number;

  @IsInt()
  @Min(1)
  AUTH_LOGIN_LOCKOUT_MINUTES!: number;

  @IsString()
  @MinLength(32)
  AUTH_IP_HASH_PEPPER!: string;

  @IsString()
  @Matches(/^[0-9a-fA-F]{64}$/, {
    message: 'MFA_ENCRYPTION_KEY must be 64 hex characters (32 bytes)',
  })
  MFA_ENCRYPTION_KEY!: string;

  @IsString()
  @IsNotEmpty()
  AUTH_REFRESH_COOKIE_NAME!: string;

  @IsBoolean()
  AUTH_COOKIE_SECURE!: boolean;

  @IsIn(['strict', 'lax', 'none'])
  AUTH_COOKIE_SAME_SITE!: string;

  @IsString()
  @IsNotEmpty()
  AUTH_COOKIE_PATH!: string;

  @IsOptional()
  @IsString()
  AUTH_COOKIE_DOMAIN?: string;

  @IsString()
  @IsNotEmpty()
  SMTP_HOST!: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  SMTP_PORT!: number;

  @IsBoolean()
  SMTP_SECURE!: boolean;

  @IsOptional()
  @IsBoolean()
  AUTH_ADMIN_MFA_REQUIRED?: boolean;

  @IsOptional()
  @IsString()
  SMTP_USER?: string;

  @IsOptional()
  @IsString()
  SMTP_PASS?: string;

  @IsString()
  @IsNotEmpty()
  EMAIL_FROM!: string;

  @IsOptional()
  @IsString()
  EMAIL_SUPPORT_URL?: string;

  @IsOptional()
  @IsIn(['preview', 'smtp'])
  MAIL_TRANSPORT?: string;

  @IsOptional()
  @IsString()
  MAIL_PREVIEW_DIR?: string;

  @IsOptional()
  @IsEmail()
  MAIL_REPLY_TO?: string;

  @IsOptional()
  @IsBoolean()
  SMTP_REQUIRE_TLS?: boolean;

  @IsInt()
  @Min(1)
  AUTH_TOKEN_RETENTION_DAYS!: number;

  @IsInt()
  @Min(1)
  AUTH_AUDIT_RETENTION_DAYS!: number;

  @IsInt()
  @Min(1)
  ACCOUNT_PENDING_DELETION_DAYS!: number;

  @IsOptional()
  @IsString()
  TRUST_PROXY?: string;

  @IsOptional()
  @IsIn(['json', 'pretty'])
  LOG_FORMAT?: string;

  @IsOptional()
  @IsBoolean()
  SWAGGER_ENABLED?: boolean;

  @IsOptional()
  @IsString()
  ADMIN_BOOTSTRAP_EMAIL?: string;

  @IsOptional()
  @IsString()
  ADMIN_BOOTSTRAP_PASSWORD?: string;

  @IsOptional()
  @IsString()
  ADMIN_BOOTSTRAP_FIRST_NAME?: string;

  @IsOptional()
  @IsString()
  ADMIN_BOOTSTRAP_LAST_NAME?: string;
}

function coerceBooleans(config: Record<string, unknown>): Record<string, unknown> {
  const out = { ...config };
  for (const key of [
    'AUTH_COOKIE_SECURE',
    'SMTP_SECURE',
    'SMTP_REQUIRE_TLS',
    'AUTH_ADMIN_MFA_REQUIRED',
    'SWAGGER_ENABLED',
  ]) {
    if (typeof out[key] === 'string') {
      const raw = (out[key] as string).trim().toLowerCase();
      if (raw !== 'true' && raw !== 'false') {
        // Never silently treat a typo (e.g. "ture", "yes") as false for a security flag.
        throw new Error(`Environment validation failed: ${key} must be "true" or "false"`);
      }
      out[key] = raw === 'true';
    }
  }
  const intKeys = [
    'AUTH_EMAIL_COOLDOWN_SECONDS',
    'EMAIL_VERIFICATION_TOKEN_EXPIRES_IN_MINUTES',
    'PASSWORD_RESET_TOKEN_EXPIRES_IN_MINUTES',
    'MFA_LOGIN_CHALLENGE_EXPIRES_IN_MINUTES',
    'EMAIL_CHANGE_TOKEN_EXPIRES_IN_MINUTES',
    'AUTH_MAX_SESSIONS',
    'AUTH_RATE_LIMIT_TTL_SECONDS',
    'AUTH_RATE_LIMIT_LIMIT',
    'AUTH_LOGIN_MAX_FAILURES',
    'AUTH_LOGIN_LOCKOUT_MINUTES',
    'SMTP_PORT',
    'AUTH_TOKEN_RETENTION_DAYS',
    'AUTH_AUDIT_RETENTION_DAYS',
    'ACCOUNT_PENDING_DELETION_DAYS',
  ];
  for (const key of intKeys) {
    if (typeof out[key] === 'string' && out[key] !== '') {
      out[key] = parseInt(out[key] as string, 10);
    }
  }
  return out;
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const prepared = coerceBooleans(config);
  const validated = plainToInstance(EnvironmentVariables, prepared, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validated, {
    skipMissingProperties: false,
    whitelist: true,
    forbidUnknownValues: false,
  });

  if (errors.length > 0) {
    const messages = errors
      .map((e) => Object.values(e.constraints ?? {}).join(', '))
      .join('; ');
    throw new Error(`Environment validation failed: ${messages}`);
  }

  assertSafeConfiguration(validated);
  return validated;
}

const MAX_PRODUCTION_ACCESS_TTL_MS = 60 * 60_000;

function parseOrigin(value: string, name: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} contains an invalid URL: ${value}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${name} must use http(s): ${value}`);
  }
  return url;
}

function isLowEntropyHexKey(hex: string): boolean {
  return new Set(hex.toLowerCase()).size < 10 || /^(0123456789abcdef)+$/i.test(hex);
}

/**
 * Cross-field and production-only safety checks (§4.16): reject unsafe defaults, weak
 * secrets, malformed TTLs and incoherent cookie/CORS/HTTPS settings at boot, never at
 * first use.
 */
export function assertSafeConfiguration(env: EnvironmentVariables): void {
  const fail = (message: string): never => {
    throw new Error(`Unsafe configuration: ${message}`);
  };
  const production = env.NODE_ENV === 'production';

  let accessTtl = 0;
  let refreshTtl = 0;
  try {
    accessTtl = parseDurationMs(env.JWT_ACCESS_EXPIRES_IN);
    refreshTtl = parseDurationMs(env.JWT_REFRESH_EXPIRES_IN);
  } catch (err) {
    fail(`JWT_ACCESS_EXPIRES_IN / JWT_REFRESH_EXPIRES_IN: ${(err as Error).message}`);
  }
  if (refreshTtl <= accessTtl) {
    fail('JWT_REFRESH_EXPIRES_IN must be longer than JWT_ACCESS_EXPIRES_IN');
  }
  if (production && accessTtl > MAX_PRODUCTION_ACCESS_TTL_MS) {
    fail('JWT_ACCESS_EXPIRES_IN must be at most 60m in production (short-lived access tokens)');
  }

  const origins = env.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (origins.length === 0) fail('CORS_ORIGINS must list at least one origin');
  for (const origin of origins) {
    if (origin.includes('*')) fail('CORS_ORIGINS must not contain wildcards with credentialed CORS');
    const url = parseOrigin(origin, 'CORS_ORIGINS');
    if (url.origin !== origin.replace(/\/$/, '')) {
      fail(`CORS_ORIGINS entries must be bare origins without path/query: ${origin}`);
    }
    if (production && url.protocol !== 'https:') {
      fail(`CORS_ORIGINS must use https in production: ${origin}`);
    }
  }

  const frontend = parseOrigin(env.APP_FRONTEND_URL, 'APP_FRONTEND_URL');
  if (production && frontend.protocol !== 'https:') {
    fail('APP_FRONTEND_URL must use https in production');
  }
  if (!origins.includes(frontend.origin)) {
    fail('APP_FRONTEND_URL origin must be listed in CORS_ORIGINS');
  }

  if (env.AUTH_COOKIE_SAME_SITE === 'none' && !env.AUTH_COOKIE_SECURE) {
    fail('AUTH_COOKIE_SAME_SITE=none requires AUTH_COOKIE_SECURE=true (browsers drop the cookie otherwise)');
  }
  const expectedCookiePrefix = `/${env.API_PREFIX.replace(/^\/|\/$/g, '')}/auth`;
  if (!env.AUTH_COOKIE_PATH.startsWith(expectedCookiePrefix)) {
    fail(`AUTH_COOKIE_PATH must be scoped to ${expectedCookiePrefix} so the refresh cookie only reaches auth routes`);
  }

  if (env.TRUST_PROXY !== undefined && !/^(false|loopback|linklocal|uniquelocal|[1-9])$/.test(env.TRUST_PROXY)) {
    fail('TRUST_PROXY must be false, loopback, linklocal, uniquelocal or a hop count 1-9');
  }

  if (!production) return;

  const secrets: Array<[string, string | undefined]> = [
    ['JWT_ACCESS_SECRET', env.JWT_ACCESS_SECRET],
    ['JWT_ACCESS_SECRET_PREVIOUS', env.JWT_ACCESS_SECRET_PREVIOUS],
    ['AUTH_TOKEN_PEPPER', env.AUTH_TOKEN_PEPPER],
    ['AUTH_IP_HASH_PEPPER', env.AUTH_IP_HASH_PEPPER],
  ];
  for (const [name, value] of secrets) {
    if (value === undefined) continue;
    if (looksWeak(value) || value.length < 32 || new Set(value).size < 12) {
      fail(`${name} is weak or a placeholder; provide a long random value`);
    }
  }
  const distinct = secrets.map(([, v]) => v).filter((v): v is string => !!v);
  if (new Set(distinct).size !== distinct.length) {
    fail('JWT secrets and peppers must all be different values');
  }
  if (isLowEntropyHexKey(env.MFA_ENCRYPTION_KEY)) {
    fail('MFA_ENCRYPTION_KEY is a placeholder or low-entropy; generate 32 random bytes as hex');
  }
  if (!env.AUTH_COOKIE_SECURE) {
    fail('AUTH_COOKIE_SECURE must be true in production');
  }
  assertProductionMail(env, fail);
}

const NON_DELIVERABLE_DOMAIN = /(^|\.)(localhost|local|test|invalid|example|example\.(com|net|org))$/i;
const LOOPBACK_HOST = /^(localhost|127\.\d+\.\d+\.\d+|::1|0\.0\.0\.0)$/i;

export function senderAddress(from: string): string {
  const angle = /<([^>]+)>/.exec(from);
  return (angle ? angle[1] : from).trim();
}

/** Production must use an authenticated, TLS-protected relay and a real sender domain. */
function assertProductionMail(env: EnvironmentVariables, fail: (message: string) => never): void {
  const transport = (env.MAIL_TRANSPORT ?? 'smtp').toLowerCase();
  if (transport !== 'smtp') {
    fail('MAIL_TRANSPORT must be "smtp" in production; the preview inbox is development-only');
  }
  if (LOOPBACK_HOST.test(env.SMTP_HOST.trim())) {
    fail('SMTP_HOST points at a local catcher; configure the real SMTP relay for production');
  }
  if (!env.SMTP_SECURE && env.SMTP_REQUIRE_TLS === false) {
    fail('SMTP_REQUIRE_TLS=false is not allowed in production without SMTP_SECURE=true');
  }
  if (env.SMTP_USER && !env.SMTP_PASS) {
    fail('SMTP_PASS is required when SMTP_USER is set');
  }
  const address = senderAddress(env.EMAIL_FROM);
  const domain = address.split('@')[1] ?? '';
  if (!domain || NON_DELIVERABLE_DOMAIN.test(domain)) {
    fail('EMAIL_FROM must use a verified sender on a real domain in production');
  }
}
