import { describe, expect, it } from 'vitest';
import { buildLoginHref, sanitizeReturnTo } from './returnTo';

describe('sanitizeReturnTo (open-redirect protection)', () => {
  it.each([
    ['/settings/profile', '/settings/profile'],
    ['/admin/users?page=2', '/admin/users?page=2'],
    ['  /dashboard  ', '/dashboard'],
  ])('keeps same-origin path %s', (input, expected) => {
    expect(sanitizeReturnTo(input)).toBe(expected);
  });

  it.each([
    null,
    undefined,
    '',
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    '\\\\evil.example',
    'javascript:alert(1)',
    '%2F%2Fevil.example',
    '/%2F%2Fevil.example',
    'dashboard',
    '/user@evil.example',
    '%E0%A4%A',
    '/%09/evil.example',
    '/\t/evil.example',
    '/%0A/evil.example',
    '/%5Cevil.example',
    '/ /evil.example',
  ])('rejects unsafe value %s', (input) => {
    expect(sanitizeReturnTo(input as string | null | undefined)).toBe('/dashboard');
  });

  it('builds login links that only carry a safe returnTo', () => {
    expect(buildLoginHref('/settings/security')).toBe('/login?returnTo=%2Fsettings%2Fsecurity');
    expect(buildLoginHref('https://evil.example')).toBe('/login');
  });
});
