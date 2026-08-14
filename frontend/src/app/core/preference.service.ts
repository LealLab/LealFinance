import { inject, Injectable, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { Observable, tap } from 'rxjs';
import { BalanceVisibilityService } from './balance-visibility.service';
import { DisplayCurrencyService } from './display-currency.service';
import { IdentityApiService } from './identity-api.service';
import { Preferences, UserTheme } from './identity.models';
import { ThemeService } from './theme.service';

@Injectable({ providedIn: 'root' })
export class PreferenceService {
  private readonly api = inject(IdentityApiService);
  private readonly transloco = inject(TranslocoService);
  private readonly theme = inject(ThemeService);
  private readonly displayCurrency = inject(DisplayCurrencyService);
  private readonly balances = inject(BalanceVisibilityService);
  private readonly state = signal<Preferences | undefined>(undefined);

  readonly preferences = this.state.asReadonly();
  readonly errorCode = signal<string | undefined>(undefined);

  hydrate(): Observable<Preferences> {
    return this.api.getPreferences().pipe(tap((preferences) => this.apply(preferences)));
  }

  clear(): void {
    this.state.set(undefined);
    this.errorCode.set(undefined);
  }

  setLocale(locale: string): void {
    this.update({ locale });
  }

  setTheme(theme: UserTheme): void {
    this.update({ theme });
  }

  setDisplayCurrency(displayCurrency: string): void {
    this.update({ displayCurrency });
  }

  setBalancesHidden(balancesHidden: boolean): void {
    this.update({ balancesHidden });
  }

  private update(changes: Partial<Preferences>): void {
    const previous = this.state();
    if (!previous) {
      if (changes.locale !== undefined) this.transloco.setActiveLang(changes.locale);
      if (changes.theme !== undefined) this.theme.setTheme(changes.theme);
      if (changes.displayCurrency !== undefined) {
        this.displayCurrency.setCurrency(changes.displayCurrency);
      }
      if (changes.balancesHidden !== undefined) {
        this.balances.setHidden(changes.balancesHidden);
      }
      return;
    }
    this.errorCode.set(undefined);
    this.apply({ ...previous, ...changes });
    this.api.updatePreferences(changes).subscribe({
      next: (saved) => this.apply(saved),
      error: (error: unknown) => {
        this.apply(previous);
        this.errorCode.set(this.codeOf(error));
      },
    });
  }

  private apply(preferences: Preferences): void {
    this.state.set(preferences);
    this.transloco.setActiveLang(preferences.locale);
    this.theme.setTheme(preferences.theme);
    this.displayCurrency.setCurrency(preferences.displayCurrency);
    this.balances.setHidden(preferences.balancesHidden);
  }

  private codeOf(error: unknown): string {
    if (typeof error === 'object' && error !== null && 'code' in error) {
      return String((error as { code: unknown }).code);
    }
    return 'error.generic';
  }
}
