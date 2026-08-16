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
  /**
   * Changes made while logged out (e.g. the theme/language toggle on the
   * login page) - applied locally right away by `update()`'s `!previous`
   * branch, but not yet known to the account. `hydrate()` re-applies them
   * over whatever the server returns and PATCHes them through, so an
   * explicit pre-login pick survives sign-in instead of being clobbered by
   * the account's saved theme/locale.
   */
  private pending: Partial<Preferences> = {};

  readonly preferences = this.state.asReadonly();
  readonly errorCode = signal<string | undefined>(undefined);

  hydrate(): Observable<Preferences> {
    return this.api.getPreferences().pipe(
      tap((preferences) => {
        if (Object.keys(this.pending).length === 0) {
          this.apply(preferences);
          return;
        }
        const changes = this.pending;
        this.pending = {};
        this.apply({ ...preferences, ...changes });
        this.api.updatePreferences(changes).subscribe({
          next: (saved) => this.apply(saved),
          // Sync failure shouldn't surface as a login error - the local
          // values are already applied and persisted (localStorage etc.).
          error: () => undefined,
        });
      }),
    );
  }

  clear(): void {
    this.state.set(undefined);
    this.pending = {};
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
      this.pending = { ...this.pending, ...changes };
      this.applyPartial(changes);
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
    this.applyPartial(preferences);
  }

  private applyPartial(changes: Partial<Preferences>): void {
    if (changes.locale !== undefined) this.transloco.setActiveLang(changes.locale);
    if (changes.theme !== undefined) this.theme.setTheme(changes.theme);
    if (changes.displayCurrency !== undefined) {
      this.displayCurrency.setCurrency(changes.displayCurrency);
    }
    if (changes.balancesHidden !== undefined) {
      this.balances.setHidden(changes.balancesHidden);
    }
  }

  private codeOf(error: unknown): string {
    if (typeof error === 'object' && error !== null && 'code' in error) {
      return String((error as { code: unknown }).code);
    }
    return 'error.generic';
  }
}
