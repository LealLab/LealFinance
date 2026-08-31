import { signal, WritableSignal } from '@angular/core';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { provideTranslocoLocale } from '@jsverse/transloco-locale';
import { BehaviorSubject, of } from 'rxjs';
import { BackupService } from '../../core/backup.service';
import { ConfirmService } from '../../core/confirm.service';
import { User } from '../../core/identity.models';
import { DisplayCurrencyService } from '../../core/display-currency.service';
import { MetadataService } from '../../core/metadata.service';
import { PreferenceService } from '../../core/preference.service';
import { SessionService } from '../../core/session.service';
import { Settings } from './settings';
import ptBR from '../../../../public/i18n/pt-BR.json';

describe('Settings', () => {
  let fragment: BehaviorSubject<string | null>;
  let sessionUser: WritableSignal<User | undefined>;
  let backupService: {
    export: ReturnType<typeof vi.fn>;
    preview: ReturnType<typeof vi.fn>;
    restore: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    fragment = new BehaviorSubject<string | null>(null);
    sessionUser = signal<User | undefined>(undefined);
    backupService = { export: vi.fn(), preview: vi.fn(), restore: vi.fn() };
    await TestBed.configureTestingModule({
      imports: [
        Settings,
        TranslocoTestingModule.forRoot({
          langs: { 'pt-BR': ptBR },
          translocoConfig: { availableLangs: ['pt-BR'], defaultLang: 'pt-BR' },
        }),
      ],
      providers: [
        provideZonelessChangeDetection(),
        provideTranslocoLocale({ defaultLocale: 'pt-BR', defaultCurrency: 'BRL' }),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { fragment: fragment.asObservable(), snapshot: { fragment: null } },
        },
        { provide: SessionService, useValue: { user: sessionUser.asReadonly() } },
        { provide: BackupService, useValue: backupService },
      ],
    }).compileComponents();
    TestBed.inject(MetadataService).currencies.set([
      { code: 'BRL', name: 'Real', symbol: 'R$', decimalDigits: 2, isActive: true },
      { code: 'USD', name: 'US Dollar', symbol: '$', decimalDigits: 2, isActive: true },
    ]);
  });

  afterEach(() => vi.restoreAllMocks());

  it('shows provider management to enabled admins', () => {
    sessionUser.set({
      id: 'admin-id',
      email: 'admin@example.com',
      displayName: 'Admin',
      role: 'admin',
      isActive: true,
      createdAt: '',
    });
    TestBed.inject(MetadataService).settings.set({
      defaultCurrency: 'BRL',
      defaultLocale: 'pt-BR',
      agentsEnabled: true,
    });

    const fixture = TestBed.createComponent(Settings);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('a[href="/admin/providers"]')).not.toBeNull();
  });

  it('hides provider management from members', () => {
    sessionUser.set({
      id: 'member-id',
      email: 'member@example.com',
      displayName: 'Member',
      role: 'member',
      isActive: true,
      createdAt: '',
    });
    TestBed.inject(MetadataService).settings.set({
      defaultCurrency: 'BRL',
      defaultLocale: 'pt-BR',
      agentsEnabled: true,
    });

    const fixture = TestBed.createComponent(Settings);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('a[href="/admin/providers"]')).toBeNull();
  });

  it('renders appearance, currency, and agents sections without mock controls', () => {
    const fixture = TestBed.createComponent(Settings);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Configurações');
    expect(text).toContain('Aparência');
    expect(text).toContain('Moeda de exibição');
    expect(text).not.toContain('Dados de demonstração');
    expect(text).toContain('Agentes de IA');
  });

  it('switches the theme when a theme button is clicked', () => {
    const fixture = TestBed.createComponent(Settings);
    fixture.detectChanges();

    const darkButton = Array.from(fixture.nativeElement.querySelectorAll('button')).find((b) =>
      (b as HTMLButtonElement).textContent?.includes('Escuro'),
    ) as HTMLButtonElement;
    darkButton.click();
    fixture.detectChanges();

    expect(fixture.componentInstance['theme'].current()).toBe('dark');
    // Reset for any test ordering that relies on light being the default.
    fixture.componentInstance['setTheme']('light');
  });

  it('shows the persisted display currency and can change it back to BRL', () => {
    const displayCurrency = TestBed.inject(DisplayCurrencyService);
    displayCurrency.setCurrency('USD');

    const fixture = TestBed.createComponent(Settings);
    fixture.detectChanges();

    const select = fixture.nativeElement.querySelector(
      '#settings-display-currency',
    ) as HTMLSelectElement;
    expect(select.value).toBe('USD');

    select.value = 'BRL';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(displayCurrency.currency()).toBe('BRL');
    expect(select.value).toBe('BRL');
  });

  it.each([
    ['settings-language', 'settings-language'],
    ['settings-display-currency', 'settings-display-currency'],
    ['settings-backup-export', 'settings-backup-export'],
    ['settings-backup-restore', 'settings-backup-restore'],
  ])('focuses the %s control when its route fragment becomes active', (routeFragment, id) => {
    const fixture = TestBed.createComponent(Settings);
    fixture.detectChanges();

    fragment.next(routeFragment);
    fixture.detectChanges();

    expect(document.activeElement).toBe(fixture.nativeElement.querySelector(`#${id}`));
  });

  it('downloads an encrypted export and forgets its one-time key when closed', () => {
    backupService.export.mockReturnValue(
      of({
        filename: 'backup.json',
        archive: { format: 'lealfinance.backup', encrypted: true },
        recoveryKey: 'one-time-key',
      }),
    );
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:backup'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const fixture = TestBed.createComponent(Settings);
    fixture.detectChanges();

    fixture.componentInstance['openExport']();
    fixture.componentInstance['exportEncrypted'].set(true);
    fixture.componentInstance['exportBackup']();
    fixture.detectChanges();

    expect(backupService.export).toHaveBeenCalledWith(true);
    expect(fixture.componentInstance['recoveryKey']()).toBe('one-time-key');
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(fixture.nativeElement.querySelector('#backup-recovery-key').value).toBe('one-time-key');
    expect(fixture.componentInstance['backupStatus']()).toBe('exported');

    fixture.componentInstance['setExportOpen'](false);
    expect(fixture.componentInstance['recoveryKey']()).toBeUndefined();
  });

  it('validates restore files, previews encrypted archives, confirms, and refreshes preferences', async () => {
    const archive = { format: 'lealfinance.backup', encrypted: true };
    const preview = {
      sourceAppVersion: '0.2.0',
      exportedAt: '2026-08-31T12:00:00Z',
      encrypted: true,
      counts: { accounts: 1 },
      warnings: [{ code: 'credentials_reconnect', params: {} }],
    };
    backupService.preview.mockReturnValue(of(preview));
    backupService.restore.mockReturnValue(of({ counts: { accounts: 1 }, warnings: [] }));
    const preferences = TestBed.inject(PreferenceService);
    const hydrate = vi.spyOn(preferences, 'hydrate').mockReturnValue(
      of({
        locale: 'pt-BR',
        theme: 'light',
        baseCurrency: 'BRL',
        displayCurrency: 'BRL',
        investmentsEnabled: false,
        balancesHidden: false,
      }),
    );
    vi.spyOn(TestBed.inject(ConfirmService), 'confirm').mockResolvedValue(true);
    const fixture = TestBed.createComponent(Settings);
    fixture.detectChanges();
    fixture.componentInstance['openRestore']();
    fixture.detectChanges();

    const input = {
      files: [
        {
          name: 'backup.json',
          size: 128,
          text: () => Promise.resolve(JSON.stringify(archive)),
        },
      ],
      value: 'backup.json',
    } as unknown as HTMLInputElement;
    await fixture.componentInstance['onRestoreFile']({ target: input } as unknown as Event);
    fixture.componentInstance['restoreRecoveryKey'].set(' key ');
    fixture.componentInstance['previewBackup']();
    fixture.detectChanges();

    expect(backupService.preview).toHaveBeenCalledWith(archive, 'key');
    expect(fixture.nativeElement.textContent).toContain('0.2.0');
    expect(fixture.nativeElement.querySelector('time').textContent.trim()).not.toBe(
      '2026-08-31T12:00:00Z',
    );
    expect(fixture.nativeElement.querySelector('#restore-recovery-key')).not.toBeNull();

    await fixture.componentInstance['replaceFromBackup']();
    expect(backupService.restore).toHaveBeenCalledWith(archive, 'key');
    expect(hydrate).toHaveBeenCalled();
    expect(fixture.componentInstance['restoreArchive']()).toBeUndefined();
    expect(fixture.componentInstance['backupStatus']()).toBe('restored');
  });

  it('rejects non-JSON and oversized restore files before reading them', async () => {
    const fixture = TestBed.createComponent(Settings);
    fixture.detectChanges();
    const file = (name: string, size: number) =>
      ({
        target: {
          files: [{ name, size, text: vi.fn(() => Promise.resolve('{}')) }],
          value: name,
        },
      }) as unknown as Event;

    await fixture.componentInstance['onRestoreFile'](file('backup.txt', 1));
    expect(fixture.componentInstance['restoreErrorCode']()).toBe('backup.invalid_file_type');

    await fixture.componentInstance['onRestoreFile'](file('backup.json', 25 * 1024 * 1024 + 1));
    expect(fixture.componentInstance['restoreErrorCode']()).toBe('backup.file_too_large');
  });
});
