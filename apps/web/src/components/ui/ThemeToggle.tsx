'use client';

import { useEffect, useState } from 'react';
import { isTheme, resolveTheme, THEME_STORAGE_KEY, type Theme } from '@/lib/theme/theme';
import styles from './ThemeToggle.module.css';

function readStored(): string | null {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}

function lightQuery(): MediaQueryList | null {
  return typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: light)') : null;
}

function currentTheme(): Theme {
  const applied = document.documentElement.dataset.theme;
  if (isTheme(applied)) return applied;
  return resolveTheme(readStored(), lightQuery()?.matches ?? false);
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(currentTheme());
    const media = lightQuery();
    if (!media) return;
    const onSystemChange = () => {
      if (isTheme(readStored())) return;
      const next: Theme = media.matches ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      setTheme(next);
    };
    media.addEventListener('change', onSystemChange);
    return () => media.removeEventListener('change', onSystemChange);
  }, []);

  function toggle() {
    const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Preference simply will not persist (e.g. storage disabled).
    }
    setTheme(next);
  }

  const label =
    theme === null ? 'Switch colour theme' : theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme';

  return (
    <button type="button" className={styles.toggle} onClick={toggle} aria-label={label} title={label}>
      {theme === 'light' ? (
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
          <path d="M15.5 12.6A6.5 6.5 0 0 1 7.4 4.5a6.5 6.5 0 1 0 8.1 8.1Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
          <circle cx="10" cy="10" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}
