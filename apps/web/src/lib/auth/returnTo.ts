/**
 * Validates same-origin relative return paths to block open redirects.
 * Only allows paths starting with a single `/` (not `//`), no scheme, no backslash, and no
 * whitespace or control characters (browsers strip tab/newline, so `/\t/evil.com` would
 * otherwise become `//evil.com`).
 */

const UNSAFE_CHARS = /[\u0000-\u001F\u007F\s\\@]/;

export function sanitizeReturnTo(
  value: string | null | undefined,
  fallback = '/dashboard',
): string {
  if (!value) return fallback;

  const trimmed = value.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return fallback;
  }
  if (UNSAFE_CHARS.test(trimmed)) {
    return fallback;
  }
  // Reject protocol-relative and absolute URLs smuggled via encoding quirks
  try {
    const decoded = decodeURIComponent(trimmed);
    if (
      decoded.startsWith('//') ||
      /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(decoded) ||
      UNSAFE_CHARS.test(decoded)
    ) {
      return fallback;
    }
  } catch {
    return fallback;
  }

  return trimmed;
}

export function buildLoginHref(returnTo?: string | null): string {
  const safe = sanitizeReturnTo(returnTo, '/dashboard');
  if (safe === '/dashboard') return '/login';
  return `/login?returnTo=${encodeURIComponent(safe)}`;
}
