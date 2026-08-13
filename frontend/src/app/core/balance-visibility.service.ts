import { effect, Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'lealfinance.balancesHidden';

/**
 * "Hide balances" preference, applied by `MoneyPipe` (see
 * shared/pipes/money.pipe.ts) to mask every rendered amount app-wide.
 * Structurally identical to ThemeService (src/app/core/theme.service.ts):
 * a boolean signal persisted to localStorage, read back on startup, writes
 * wrapped in try/catch since private browsing can throw on storage access.
 * Default is `false` (balances shown) — there's no OS-level signal to
 * derive an initial value from the way theme has `prefers-color-scheme`.
 */
@Injectable({ providedIn: 'root' })
export class BalanceVisibilityService {
  private readonly hiddenSignal = signal<boolean>(this.readInitial());

  readonly hidden = this.hiddenSignal.asReadonly();

  constructor() {
    effect(() => {
      this.persist(this.hiddenSignal());
    });
  }

  toggle(): void {
    this.hiddenSignal.update((current) => !current);
  }

  setHidden(hidden: boolean): void {
    this.hiddenSignal.set(hidden);
  }

  private readInitial(): boolean {
    return this.readStorage() === 'true';
  }

  private readStorage(): string | null {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      // Private browsing / storage disabled — fall back to the default.
      return null;
    }
  }

  private persist(value: boolean): void {
    try {
      localStorage.setItem(STORAGE_KEY, String(value));
    } catch {
      // Storage unavailable — preference still applies for the current session.
    }
  }
}
