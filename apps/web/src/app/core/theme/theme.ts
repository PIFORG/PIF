export type Theme = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'mtrs-theme';

export function isTheme(value: unknown): value is Theme {
  return value === 'dark' || value === 'light';
}

/**
 * Choix explicite si l'utilisateur en a enregistré un.
 * Sans préférence stockée : mode clair (expérience de référence),
 * indépendamment de la préférence système.
 */
export function resolveTheme(stored: string | null, prefersLight: boolean): Theme {
  if (isTheme(stored)) return stored;
  void prefersLight;
  return 'light';
}
