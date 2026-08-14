import { effect, Injectable, signal } from '@angular/core';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'lealfinance.theme';

/**
 * Light/dark theme, applied by writing `data-theme` on <html> (see the
 * `@custom-variant dark` rule and token overrides in
 * src/styles/tailwind.css). Preference persists to localStorage - like the
 * language preference (transloco-persist-lang), this is a UI setting, not
 * mock domain data, so it survives a reload on purpose.
 *
 * Initial value: a stored preference wins; otherwise the OS
 * `prefers-color-scheme` is used as a starting point, not a hard binding -
 * once the user toggles, the stored choice takes over permanently.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly theme = signal<Theme>(this.readInitialTheme());

  readonly current = this.theme.asReadonly();

  constructor() {
    effect(() => {
      const value = this.theme();
      document.documentElement.setAttribute('data-theme', value);
      this.persist(value);
    });
  }

  toggle(): void {
    this.theme.update((current) => (current === 'dark' ? 'light' : 'dark'));
  }

  setTheme(theme: Theme): void {
    this.theme.set(theme);
  }

  private readInitialTheme(): Theme {
    const stored = this.readStorage();
    if (stored === 'light' || stored === 'dark') {
      return stored;
    }
    return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light';
  }

  private readStorage(): string | null {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      // Private browsing / storage disabled - fall back to prefers-color-scheme.
      return null;
    }
  }

  private persist(value: Theme): void {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // Storage unavailable - theme still applies for the current session.
    }
  }
}
