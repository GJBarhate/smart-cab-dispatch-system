import { create } from 'zustand';

export type Theme = 'light' | 'dark';

// Shared with the inline bootstrap script in index.html — both must agree on
// the key, or the pre-paint class and the store would disagree on first load.
export const THEME_STORAGE_KEY = 'eventride-admin-theme';

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
}

export function readStoredTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // Private-mode / blocked storage — fall through to the OS preference.
  }
  return systemPrefersDark() ? 'dark' : 'light';
}

function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  // Keeps the mobile browser chrome in step with the app surface.
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0b0e14' : '#6d28d9');
}

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: readStoredTheme(),
  setTheme: (theme) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Preference just won't survive a reload; the session still themes.
    }
    applyTheme(theme);
    set({ theme });
  },
  toggle: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark')
}));

/** Applies the stored theme on boot and keeps it in sync with the OS setting. */
export function initTheme(): () => void {
  applyTheme(useThemeStore.getState().theme);

  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  if (!media) return () => undefined;

  const onChange = (e: MediaQueryListEvent): void => {
    // Only follow the OS while the user has not made an explicit choice.
    let hasExplicitChoice = false;
    try {
      hasExplicitChoice = localStorage.getItem(THEME_STORAGE_KEY) !== null;
    } catch {
      hasExplicitChoice = false;
    }
    if (hasExplicitChoice) return;
    const next: Theme = e.matches ? 'dark' : 'light';
    useThemeStore.setState({ theme: next }, false);
    applyTheme(next);
  };

  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
