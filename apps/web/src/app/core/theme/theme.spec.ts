import { resolveTheme } from './theme';

describe('resolveTheme', () => {
  it('utilise le mode clair par défaut sans préférence stockée', () => {
    expect(resolveTheme(null, false)).toBe('light');
    expect(resolveTheme(null, true)).toBe('light');
  });

  it('respecte le choix explicite stocké', () => {
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('light', false)).toBe('light');
  });
});
