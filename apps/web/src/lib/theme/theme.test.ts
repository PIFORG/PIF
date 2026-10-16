import { describe, expect, it } from 'vitest';
import { isTheme, resolveTheme, THEME_BOOTSTRAP_SCRIPT, THEME_STORAGE_KEY } from './theme';

describe('theme', () => {
  it('prefers an explicit stored choice over the system preference', () => {
    expect(resolveTheme('light', false)).toBe('light');
    expect(resolveTheme('dark', true)).toBe('dark');
  });

  it('falls back to the system preference for missing or invalid values', () => {
    expect(resolveTheme(null, true)).toBe('light');
    expect(resolveTheme(null, false)).toBe('dark');
    expect(resolveTheme('sepia', true)).toBe('light');
  });

  it('validates theme names', () => {
    expect(isTheme('dark')).toBe(true);
    expect(isTheme('auto')).toBe(false);
  });

  it('bootstrap script reads the same storage key and never throws', () => {
    expect(THEME_BOOTSTRAP_SCRIPT).toContain(THEME_STORAGE_KEY);
    expect(THEME_BOOTSTRAP_SCRIPT).toContain('catch');
  });
});
