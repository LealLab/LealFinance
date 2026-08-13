import { effect, Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'lealfinance.displayCurrency';
const DEFAULT_CURRENCY = 'USD';

/**
 * The currency multi-currency figures (net worth, cross-account totals)
 * convert into for display — a UI preference, like ThemeService, so it
 * persists across reloads independently of the in-memory mock domain
 * data. Read by the dashboard; changed from Settings.
 */
@Injectable({ providedIn: 'root' })
export class DisplayCurrencyService {
  private readonly currencySignal = signal(this.readInitial());

  readonly currency = this.currencySignal.asReadonly();

  constructor() {
    effect(() => {
      try {
        localStorage.setItem(STORAGE_KEY, this.currencySignal());
      } catch {
        // Storage unavailable — preference still applies for this session.
      }
    });
  }

  setCurrency(code: string): void {
    this.currencySignal.set(code);
  }

  private readInitial(): string {
    try {
      return localStorage.getItem(STORAGE_KEY) || DEFAULT_CURRENCY;
    } catch {
      return DEFAULT_CURRENCY;
    }
  }
}
