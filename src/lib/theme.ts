// Dark mode: a manual UI preference, not app data — deliberately kept out of
// the Settings table (§3) and stored in localStorage instead.

const STORAGE_KEY = 'dsa-revision-theme';

export type Theme = 'light' | 'dark';

export function getInitialTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  localStorage.setItem(STORAGE_KEY, theme);
}
