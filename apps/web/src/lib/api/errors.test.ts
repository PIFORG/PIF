import { describe, expect, it } from 'vitest';
import { describeApiError, hasErrorCode } from './errors';
import { ApiError } from './types';

describe('describeApiError', () => {
  it('keeps the server message for ordinary errors', () => {
    expect(describeApiError(new ApiError(400, 'New email must differ'), 'x')).toBe('New email must differ');
  });

  it('replaces messages for codes that need next-step guidance', () => {
    expect(describeApiError(new ApiError(403, 'Forbidden', 'ADMIN_MFA_REQUIRED'), 'x')).toMatch(
      /two-step verification/,
    );
    expect(describeApiError(new ApiError(400, 'expired', 'MFA_SETUP_EXPIRED'), 'x')).toMatch(/Start the setup again/);
  });

  it('appends validation details', () => {
    const err = new ApiError(400, 'Validation failed', 'VALIDATION_ERROR', ['email must be an email']);
    expect(describeApiError(err, 'x')).toBe('Validation failed: email must be an email');
  });

  it('explains network failures and falls back for unknown errors', () => {
    expect(describeApiError(new TypeError('Failed to fetch'), 'fallback')).toMatch(/could not be reached/);
    expect(describeApiError(new Error('boom'), 'fallback')).toBe('fallback');
  });

  it('matches error codes', () => {
    expect(hasErrorCode(new ApiError(401, 'x', 'MFA_INVALID'), 'TOKEN_INVALID', 'MFA_INVALID')).toBe(true);
    expect(hasErrorCode(new Error('x'), 'MFA_INVALID')).toBe(false);
  });
});
