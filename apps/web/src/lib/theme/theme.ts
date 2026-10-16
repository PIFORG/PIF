export type Theme = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'mtrs-theme';

export function isTheme(value: unknown): value is Theme {
  return value === 'dark' || value === 'light';
}

/** Explicit choice if the user made one, otherwise the operating-system preference. */
export function resolveTheme(stored: string | null, prefersLight: boolean): Theme {
  if (isTheme(stored)) return stored;
  return prefersLight ? 'light' : 'dark';
}

/**
 * Runs before first paint (inlined in the root layout) so the page never flashes the
 * wrong theme. Kept dependency-free and wrapped in try/catch for privacy modes.
 */
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var s=localStorage.getItem('${THEME_STORAGE_KEY}');var t=(s==='light'||s==='dark')?s:(window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark');document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme='dark';}})();`;
