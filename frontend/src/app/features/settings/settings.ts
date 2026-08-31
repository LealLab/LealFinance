import {
  Component,
  ElementRef,
  effect,
  inject,
  signal,
  type WritableSignal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import qrcode from 'qrcode-generator';
import { Observable } from 'rxjs';
import { DisplayCurrencyService } from '../../core/display-currency.service';
import { IdentityApiService } from '../../core/identity-api.service';
import { TotpSetup, TotpStatus } from '../../core/identity.models';
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
  private readonly identityApi = inject(IdentityApiService);
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

  // --- Two-factor authentication ---
  protected readonly totp = signal<TotpStatus | undefined>(undefined);
  /** Set while enrolling: holds the pending secret and its QR image. */
  protected readonly totpSetup = signal<(TotpSetup & { qrDataUrl: string }) | undefined>(undefined);
  /** Shown exactly once, right after enrollment or regeneration - the server
   * only stores hashes, so there is no way to display them again later. */
  protected readonly backupCodes = signal<string[] | undefined>(undefined);
  protected readonly totpCode = signal('');
  protected readonly totpBusy = signal(false);
  protected readonly totpErrorCode = signal<string | undefined>(undefined);
  protected readonly backupCodesCopied = signal(false);

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
  private readonly twoFactorSection = viewChild<ElementRef<HTMLElement>>('twoFactorSection');

  constructor() {
    this.loadMarketDataCredentials();
    this.loadTotpStatus();
    effect(() => {
      const target =
        this.fragment() === 'settings-language'
          ? this.languageSelect()?.nativeElement
          : this.fragment() === 'settings-display-currency'
            ? this.displayCurrencySelect()?.nativeElement
            : this.fragment() === 'settings-two-factor'
              ? this.twoFactorSection()?.nativeElement
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

  // --- Two-factor authentication ---

  protected setTotpCode(value: string): void {
    this.totpCode.set(value);
  }

  protected startTotpEnrollment(): void {
    this.runTotpAction(this.identityApi.startTotpEnrollment(), (setup) => {
      this.totpSetup.set({ ...setup, qrDataUrl: this.qrDataUrl(setup.otpauthUri) });
    });
  }

  protected cancelTotpEnrollment(): void {
    // The pending secret stays on the server but gates nothing until it is
    // confirmed, and starting over simply overwrites it.
    this.totpSetup.set(undefined);
    this.totpCode.set('');
    this.totpErrorCode.set(undefined);
  }

  protected confirmTotp(): void {
    const code = this.totpCode().trim();
    if (!code) return;
    this.runTotpAction(this.identityApi.enableTotp(code), (codes) => {
      this.totpSetup.set(undefined);
      this.showBackupCodes(codes);
      this.loadTotpStatus();
    });
  }

  protected regenerateBackupCodes(): void {
    const code = this.totpCode().trim();
    if (!code) return;
    this.runTotpAction(this.identityApi.regenerateBackupCodes(code), (codes) => {
      this.showBackupCodes(codes);
      this.loadTotpStatus();
    });
  }

  protected disableTotp(): void {
    const code = this.totpCode().trim();
    if (!code) return;
    this.runTotpAction(this.identityApi.disableTotp(code), () => {
      this.backupCodes.set(undefined);
      this.loadTotpStatus();
    });
  }

  protected dismissBackupCodes(): void {
    this.backupCodes.set(undefined);
    this.backupCodesCopied.set(false);
  }

  protected copyBackupCodes(): void {
    const codes = this.backupCodes();
    if (!codes) return;
    void navigator.clipboard?.writeText(codes.join('\n'));
    this.backupCodesCopied.set(true);
  }

  private showBackupCodes(codes: string[]): void {
    this.backupCodes.set(codes);
    this.backupCodesCopied.set(false);
  }

  /** GIF data URI for an <img>. The QR is drawn client-side so the backend
   * only ever hands out the otpauth:// URI. */
  private qrDataUrl(otpauthUri: string): string {
    const qr = qrcode(0, 'M');
    qr.addData(otpauthUri);
    qr.make();
    return qr.createDataURL(6, 2);
  }

  private runTotpAction<T>(request: Observable<T>, onSuccess: (value: T) => void): void {
    this.totpBusy.set(true);
    this.totpErrorCode.set(undefined);
    request.subscribe({
      next: (value) => {
        this.totpCode.set('');
        onSuccess(value);
        this.totpBusy.set(false);
      },
      error: (error: unknown) => {
        this.totpErrorCode.set(
          typeof error === 'object' && error !== null && 'code' in error
            ? String((error as { code: unknown }).code)
            : 'error.generic',
        );
        this.totpBusy.set(false);
      },
    });
  }

  private loadTotpStatus(): void {
    this.identityApi.totpStatus().subscribe({
      next: (status) => this.totp.set(status),
      error: () => this.totp.set(undefined),
    });
  }
}
