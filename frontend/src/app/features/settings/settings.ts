import { Component, ElementRef, effect, inject, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { ConfirmService } from '../../core/confirm.service';
import { DisplayCurrencyService } from '../../core/display-currency.service';
import { Theme, ThemeService } from '../../core/theme.service';
import { MockStore } from '../../data/mock/mock-store';
import { CURRENCY_OPTIONS } from '../../shared/currency-options';
import { Button } from '../../shared/ui/button/button';
import { Card } from '../../shared/ui/card/card';
import { Icon } from '../../shared/ui/icon/icon';
import { PageHeader } from '../../shared/ui/page-header/page-header';

/**
 * The literal keys passed to `confirmService.confirm(...)` below are real
 * string literals, but the call itself isn't to the `t` marker function,
 * so transloco-keys-manager's extractor never sees them - same "dynamic
 * markings" situation as transactions.ts/budgets.ts:
 * t(settings.mockData.reset.confirmTitle, settings.mockData.reset.confirmMessage)
 */
@Component({
  selector: 'app-settings',
  imports: [TranslocoDirective, Button, Card, Icon, PageHeader],
  templateUrl: './settings.html',
  styleUrl: './settings.scss'
})
export class Settings {
  protected readonly theme = inject(ThemeService);
  protected readonly displayCurrencyService = inject(DisplayCurrencyService);
  private readonly transloco = inject(TranslocoService);
  private readonly route = inject(ActivatedRoute);
  private readonly mockStore = inject(MockStore);
  private readonly confirmService = inject(ConfirmService);

  protected readonly currencyOptions = CURRENCY_OPTIONS;
  protected readonly availableLangs = this.transloco.getAvailableLangs() as string[];
  protected readonly activeLang = toSignal(this.transloco.langChanges$, {
    initialValue: this.transloco.getActiveLang()
  });
  private readonly fragment = toSignal(this.route.fragment, { initialValue: this.route.snapshot.fragment });
  private readonly languageSelect = viewChild<ElementRef<HTMLSelectElement>>('languageSelect');
  private readonly displayCurrencySelect = viewChild<ElementRef<HTMLSelectElement>>('displayCurrencySelect');

  constructor() {
    effect(() => {
      const target =
        this.fragment() === 'settings-language'
          ? this.languageSelect()?.nativeElement
          : this.fragment() === 'settings-display-currency'
            ? this.displayCurrencySelect()?.nativeElement
            : undefined;

      if (!target) return;
      target.scrollIntoView?.({ block: 'center' });
      target.focus();
    });
  }

  protected setLang(lang: string): void {
    this.transloco.setActiveLang(lang);
  }

  protected setTheme(theme: Theme): void {
    this.theme.setTheme(theme);
  }

  protected setDisplayCurrency(currency: string): void {
    this.displayCurrencyService.setCurrency(currency);
  }

  protected async resetMockData(): Promise<void> {
    const confirmed = await this.confirmService.confirm(
      'settings.mockData.reset.confirmTitle',
      'settings.mockData.reset.confirmMessage',
      'danger'
    );
    if (!confirmed) return;

    this.mockStore.reset();
    // A full reload is the simplest way to guarantee every already-mounted
    // screen's own resources start over clean - each feature owns its own
    // rxResource instances, so resetting the store alone wouldn't refresh
    // whichever ones are currently on screen.
    window.location.reload();
  }
}
