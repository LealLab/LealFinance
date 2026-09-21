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
import { TranslocoLocaleService } from '@jsverse/transloco-locale';
import { catchError, of, switchMap } from 'rxjs';
import { ApiError } from '../../core/api-error';
import { BackupArchive, BackupPreview, BackupService } from '../../core/backup.service';
import { ConfirmService } from '../../core/confirm.service';
import { DisplayCurrencyService } from '../../core/display-currency.service';
import { MetadataService } from '../../core/metadata.service';
import { PreferenceService } from '../../core/preference.service';
import { SessionService } from '../../core/session.service';
import { Theme, ThemeService } from '../../core/theme.service';
import { MarketDataCredentialRepository } from '../../data/market-data-credential.repository';
import { AgentChatRepository } from '../../data/agent-chat.repository';
import {
  MarketDataCredentialStatus,
  MarketDataProvider,
} from '../../domain/models/market-data-credential';
import { Button } from '../../shared/ui/button/button';
import { Card } from '../../shared/ui/card/card';
import { Icon } from '../../shared/ui/icon/icon';
import { Modal } from '../../shared/ui/modal/modal';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { MemoriesSection } from './memories-section';

const MAX_BACKUP_BYTES = 25 * 1024 * 1024;

@Component({
  selector: 'app-settings',
  imports: [TranslocoDirective, Button, Card, Icon, MemoriesSection, Modal, PageHeader, RouterLink],
  templateUrl: './settings.html',
})
export class Settings {
  protected readonly theme = inject(ThemeService);
  protected readonly displayCurrencyService = inject(DisplayCurrencyService);
  private readonly transloco = inject(TranslocoService);
  private readonly locale = inject(TranslocoLocaleService);
  private readonly route = inject(ActivatedRoute);
  private readonly backups = inject(BackupService);
  private readonly confirm = inject(ConfirmService);
  protected readonly preferences = inject(PreferenceService);
  protected readonly metadata = inject(MetadataService);
  protected readonly session = inject(SessionService);
  private readonly agentChatRepo = inject(AgentChatRepository);
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
  protected readonly exportOpen = signal(false);
  protected readonly exportEncrypted = signal(false);
  protected readonly exportLoading = signal(false);
  protected readonly recoveryKey = signal<string | undefined>(undefined);
  protected readonly recoveryKeyCopied = signal(false);
  protected readonly exportErrorCode = signal<string | undefined>(undefined);
  protected readonly restoreOpen = signal(false);
  protected readonly restoreArchive = signal<BackupArchive | undefined>(undefined);
  protected readonly restoreFilename = signal<string | undefined>(undefined);
  protected readonly restoreEncrypted = signal(false);
  protected readonly restoreRecoveryKey = signal('');
  protected readonly restorePreview = signal<BackupPreview | undefined>(undefined);
  protected readonly restoreLoading = signal(false);
  protected readonly restoreErrorCode = signal<string | undefined>(undefined);
  protected readonly backupStatus = signal<'exported' | 'restored' | undefined>(undefined);

  // --- Custom AI instructions ---
  protected readonly aiInstructions = signal('');
  protected readonly aiInstructionsBusy = signal(false);
  protected readonly aiInstructionsLoadError = signal(false);
  protected readonly aiInstructionsSaved = signal(false);
  /** Backend error code, rendered as `errors.<code>`. */
  protected readonly aiInstructionsErrorCode = signal<string | undefined>(undefined);
  /** The classifier's one-line reason, already written in the user's language. */
  protected readonly aiInstructionsReason = signal<string | undefined>(undefined);
  // Mirrors the backend INSTRUCTIONS_MAX_LENGTH cap; keep the two in sync.
  protected readonly aiInstructionsMaxLength = 2000;

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
  private readonly backupActions = viewChild<ElementRef<HTMLDivElement>>('backupActions');

  constructor() {
    this.loadMarketDataCredentials();
    this.loadAiInstructions();
    effect(() => {
      const target =
        this.fragment() === 'settings-language'
          ? this.languageSelect()?.nativeElement
          : this.fragment() === 'settings-display-currency'
            ? this.displayCurrencySelect()?.nativeElement
            : this.fragment() === 'settings-backup-export'
              ? this.backupActions()?.nativeElement.querySelector<HTMLButtonElement>(
                  '#settings-backup-export',
                )
              : this.fragment() === 'settings-backup-restore'
                ? this.backupActions()?.nativeElement.querySelector<HTMLButtonElement>(
                    '#settings-backup-restore',
                  )
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

  private loadAiInstructions(): void {
    const user = this.session.user();
    if (user?.role !== 'admin' && !user?.aiChatEnabled) return;
    this.agentChatRepo.getInstructions().subscribe({
      next: (value) => {
        this.aiInstructions.set(value);
        this.aiInstructionsLoadError.set(false);
      },
      error: () => this.aiInstructionsLoadError.set(true),
    });
  }

  protected setAiInstructions(value: string): void {
    this.aiInstructions.set(value);
    this.aiInstructionsSaved.set(false);
    this.aiInstructionsErrorCode.set(undefined);
    this.aiInstructionsReason.set(undefined);
  }

  protected saveAiInstructions(): void {
    if (this.aiInstructionsLoadError()) return;
    this.aiInstructionsBusy.set(true);
    this.aiInstructionsSaved.set(false);
    this.aiInstructionsErrorCode.set(undefined);
    this.aiInstructionsReason.set(undefined);
    this.agentChatRepo.saveInstructions(this.aiInstructions()).subscribe({
      next: (value) => {
        // Only a saved value is reflected back - a refused one is never stored,
        // so the textarea keeps what the user typed for them to edit.
        this.aiInstructions.set(value);
        this.aiInstructionsBusy.set(false);
        this.aiInstructionsSaved.set(true);
      },
      error: (error: unknown) => {
        this.aiInstructionsBusy.set(false);
        this.aiInstructionsErrorCode.set(
          error instanceof ApiError ? error.code : 'error.generic',
        );
        const reason = error instanceof ApiError ? error.params?.['reason'] : undefined;
        this.aiInstructionsReason.set(typeof reason === 'string' ? reason : undefined);
      },
    });
  }

  protected openExport(): void {
    this.backupStatus.set(undefined);
    this.exportOpen.set(true);
  }

  protected setExportOpen(open: boolean): void {
    this.exportOpen.set(open);
    if (open) return;
    this.exportEncrypted.set(false);
    this.exportLoading.set(false);
    this.recoveryKey.set(undefined);
    this.recoveryKeyCopied.set(false);
    this.exportErrorCode.set(undefined);
  }

  protected exportBackup(): void {
    this.exportLoading.set(true);
    this.exportErrorCode.set(undefined);
    this.backups.export(this.exportEncrypted()).subscribe({
      next: (result) => {
        this.download(result.archive, result.filename);
        this.exportLoading.set(false);
        if (result.recoveryKey) {
          this.recoveryKey.set(result.recoveryKey);
          this.backupStatus.set('exported');
          return;
        }
        this.setExportOpen(false);
        this.backupStatus.set('exported');
      },
      error: (error: unknown) => {
        this.exportLoading.set(false);
        this.exportErrorCode.set(this.codeOf(error));
      },
    });
  }

  protected copyRecoveryKey(input: HTMLInputElement): void {
    input.select();
    const clipboard = globalThis.navigator.clipboard;
    if (!clipboard) return;
    void clipboard
      .writeText(this.recoveryKey() ?? '')
      .then(() => this.recoveryKeyCopied.set(true))
      .catch(() => undefined);
  }

  protected openRestore(): void {
    this.backupStatus.set(undefined);
    this.restoreOpen.set(true);
  }

  protected setRestoreOpen(open: boolean): void {
    this.restoreOpen.set(open);
    if (open) return;
    this.restoreArchive.set(undefined);
    this.restoreFilename.set(undefined);
    this.restoreEncrypted.set(false);
    this.restoreRecoveryKey.set('');
    this.restorePreview.set(undefined);
    this.restoreLoading.set(false);
    this.restoreErrorCode.set(undefined);
  }

  protected async onRestoreFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    this.restoreArchive.set(undefined);
    this.restoreFilename.set(undefined);
    this.restoreEncrypted.set(false);
    this.restorePreview.set(undefined);
    this.restoreRecoveryKey.set('');
    this.restoreErrorCode.set(undefined);
    if (!file.name.toLowerCase().endsWith('.json')) {
      this.restoreErrorCode.set('backup.invalid_file_type');
      return;
    }
    if (file.size > MAX_BACKUP_BYTES) {
      this.restoreErrorCode.set('backup.file_too_large');
      return;
    }

    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('invalid backup archive');
      }
      const archive = parsed as BackupArchive;
      this.restoreArchive.set(archive);
      this.restoreFilename.set(file.name);
      this.restoreEncrypted.set(archive['encrypted'] === true);
    } catch {
      this.restoreErrorCode.set('backup.invalid_archive');
    }
  }

  protected previewBackup(): void {
    const archive = this.restoreArchive();
    if (!archive) return;
    this.restoreLoading.set(true);
    this.restorePreview.set(undefined);
    this.restoreErrorCode.set(undefined);
    this.backups.preview(archive, this.restoreKey()).subscribe({
      next: (preview) => {
        this.restorePreview.set(preview);
        this.restoreLoading.set(false);
      },
      error: (error: unknown) => {
        this.restoreLoading.set(false);
        this.restoreErrorCode.set(this.codeOf(error));
      },
    });
  }

  protected async replaceFromBackup(): Promise<void> {
    const archive = this.restoreArchive();
    if (!archive || !this.restorePreview()) return;
    const confirmed = await this.confirm.confirm(
      'settings.backup.confirm.title',
      'settings.backup.confirm.message',
      'danger',
    );
    if (!confirmed) return;

    this.restoreLoading.set(true);
    this.restoreErrorCode.set(undefined);
    this.backups
      .restore(archive, this.restoreKey())
      .pipe(
        switchMap(() => this.preferences.hydrate().pipe(catchError(() => of(undefined)))),
      )
      .subscribe({
        next: () => {
          this.setRestoreOpen(false);
          this.backupStatus.set('restored');
        },
        error: (error: unknown) => {
          this.restoreLoading.set(false);
          this.restoreErrorCode.set(this.codeOf(error));
        },
      });
  }

  protected countEntries(preview: BackupPreview): [string, number][] {
    return Object.entries(preview.counts);
  }

  protected formatExportedAt(value: string): string {
    return this.locale.localizeDate(value, undefined, { dateStyle: 'medium', timeStyle: 'short' });
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

  private restoreKey(): string | undefined {
    const key = this.restoreRecoveryKey().trim();
    return key || undefined;
  }

  private download(archive: BackupArchive, filename: string): void {
    const blob = new Blob([JSON.stringify(archive)], { type: 'application/json' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  }

  private codeOf(error: unknown): string {
    return error instanceof ApiError ? error.code : 'error.generic';
  }

}
