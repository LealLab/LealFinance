import { Component, ElementRef, effect, inject, signal, type WritableSignal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { DisplayCurrencyService } from '../../core/display-currency.service';
import { MetadataService } from '../../core/metadata.service';
import { PreferenceService } from '../../core/preference.service';
import { SessionService } from '../../core/session.service';
import { Theme, ThemeService } from '../../core/theme.service';
import { MarketDataCredentialRepository } from '../../data/market-data-credential.repository';
import {
  MarketDataCredentialStatus,
  MarketDataProvider,
} from '../../domain/models/market-data-credential';
import { Button } from '../../shared/ui/button/button';
import { Card } from '../../shared/ui/card/card';
import { Icon } from '../../shared/ui/icon/icon';
import { PageHeader } from '../../shared/ui/page-header/page-header';

@Component({
  selector: 'app-settings',
  imports: [TranslocoDirective, Button, Card, Icon, PageHeader, RouterLink],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class Settings {
  protected readonly theme = inject(ThemeService);
  protected readonly displayCurrencyService = inject(DisplayCurrencyService);
  private readonly transloco = inject(TranslocoService);
  private readonly route = inject(ActivatedRoute);
  protected readonly preferences = inject(PreferenceService);
  protected readonly metadata = inject(MetadataService);
  protected readonly session = inject(SessionService);
  private readonly marketDataCredentials = inject(MarketDataCredentialRepository, {
    optional: true,
  });

  protected readonly marketDataProviders = [
    { id: 'twelve_data', labelKey: 'twelveData' },
    { id: 'brapi', labelKey: 'brapi' },
  ] as const satisfies readonly { id: MarketDataProvider; labelKey: string }[];
  protected readonly marketDataStatuses = signal<MarketDataCredentialStatus[]>([]);
  protected readonly marketDataSaving = signal<MarketDataProvider | null>(null);
  protected readonly marketDataSaveError = signal(false);
  protected readonly marketDataKeys: Record<MarketDataProvider, WritableSignal<string>> = {
    twelve_data: signal(''),
    brapi: signal(''),
  };

  protected readonly currencyOptions = this.metadata.currencies;
  protected readonly availableLangs = this.transloco.getAvailableLangs() as string[];
  protected readonly activeLang = toSignal(this.transloco.langChanges$, {
    initialValue: this.transloco.getActiveLang(),
  });
  private readonly fragment = toSignal(this.route.fragment, {
    initialValue: this.route.snapshot.fragment,
  });
  private readonly languageSelect = viewChild<ElementRef<HTMLSelectElement>>('languageSelect');
  private readonly displayCurrencySelect =
    viewChild<ElementRef<HTMLSelectElement>>('displayCurrencySelect');

  constructor() {
    this.loadMarketDataCredentials();
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
    this.preferences.setLocale(lang);
  }

  protected setTheme(theme: Theme): void {
    this.preferences.setTheme(theme);
  }

  protected setDisplayCurrency(currency: string): void {
    this.preferences.setDisplayCurrency(currency);
  }

  protected setInvestmentsEnabled(value: boolean): void {
    this.preferences.setInvestmentsEnabled(value);
  }

  protected marketDataStatus(provider: MarketDataProvider): MarketDataCredentialStatus | undefined {
    return this.marketDataStatuses().find((status) => status.provider === provider);
  }

  protected setMarketDataKey(provider: MarketDataProvider, value: string): void {
    this.marketDataKeys[provider].set(value);
  }

  protected saveMarketDataKey(provider: MarketDataProvider): void {
    const apiKey = this.marketDataKeys[provider]().trim();
    if (!apiKey || !this.marketDataCredentials) return;
    this.marketDataSaving.set(provider);
    this.marketDataSaveError.set(false);
    this.marketDataCredentials.link(provider, apiKey).subscribe({
      next: () => {
        this.marketDataKeys[provider].set('');
        this.marketDataSaving.set(null);
        this.loadMarketDataCredentials();
      },
      error: () => {
        this.marketDataSaving.set(null);
        this.marketDataSaveError.set(true);
      },
    });
  }

  protected clearMarketDataKey(provider: MarketDataProvider): void {
    if (!this.marketDataCredentials) return;
    this.marketDataSaving.set(provider);
    this.marketDataSaveError.set(false);
    this.marketDataCredentials.unlink(provider).subscribe({
      next: () => {
        this.marketDataSaving.set(null);
        this.loadMarketDataCredentials();
      },
      error: () => {
        this.marketDataSaving.set(null);
        this.marketDataSaveError.set(true);
      },
    });
  }

  private loadMarketDataCredentials(): void {
    this.marketDataCredentials?.list().subscribe({
      next: (statuses) => this.marketDataStatuses.set(statuses),
      error: () => this.marketDataSaveError.set(true),
    });
  }
}
