export type Theme = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'mtrs-theme';

export function isTheme(value: unknown): value is Theme {
  return value === 'dark' || value === 'light';
}

/**
 * Explicit choice if the user made one.
 * With nothing stored, Market Trading Room stays on the dark command center.
 * The operating-system light preference does not override that default.
 */
export function resolveTheme(stored: string | null, prefersLight: boolean): Theme {
  if (isTheme(stored)) return stored;
  void prefersLight;
  return 'dark';
}
