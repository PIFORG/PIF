import { ApiError } from './types';

/** Messages for codes where the raw server text is not enough to act on. */
const CODE_MESSAGES: Record<string, string> = {
  ADMIN_MFA_REQUIRED:
    'Administrator tools require two-step verification. Enable it under Settings → Security, then try again.',
  MFA_REQUIRED: 'Enter the code from your authenticator app to confirm this action.',
  MFA_SETUP_EXPIRED: 'The authenticator setup expired. Start the setup again to get a new secret.',
  RATE_LIMITED: 'Too many attempts. Wait a few minutes before trying again.',
  CSRF_REJECTED: 'The request was blocked because its origin could not be verified. Reload the page and try again.',
  CONCURRENT_UPDATE: 'This account was changed by someone else at the same time. Reload and try again.',
};

/**
 * One user-facing sentence (plus any field-level details) for an error thrown by the API
 * client. Server messages are kept unless a code needs clearer next-step guidance.
 */
export function describeApiError(err: unknown, fallback: string): string {
  if (!(err instanceof ApiError)) {
    return err instanceof TypeError
      ? 'The server could not be reached. Check your connection and try again.'
      : fallback;
  }
  const base = (err.code && CODE_MESSAGES[err.code]) || err.message || fallback;
  if (err.details?.length && err.code === 'VALIDATION_ERROR') {
    return `${base}: ${err.details.join('; ')}`;
  }
  return base;
}

export function hasErrorCode(err: unknown, ...codes: string[]): boolean {
  return err instanceof ApiError && !!err.code && codes.includes(err.code);
}
