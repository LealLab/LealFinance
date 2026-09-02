import { signal, WritableSignal } from '@angular/core';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { ApiError } from '../../core/api-error';
import { BackupService } from '../../core/backup.service';
import { ConfirmService } from '../../core/confirm.service';
import { IdentityApiService } from '../../core/identity-api.service';
import { User } from '../../core/identity.models';
import { DisplayCurrencyService } from '../../core/display-currency.service';
import { MetadataService } from '../../core/metadata.service';
import { PreferenceService } from '../../core/preference.service';
import { SessionService } from '../../core/session.service';
import { AgentChatRepository } from '../../data/agent-chat.repository';
import { Settings } from './settings';
import { provideTestTransloco, provideTestTranslocoLocale } from '../../../testing/transloco';

describe('Settings', () => {
  let fragment: BehaviorSubject<string | null>;
  let sessionUser: WritableSignal<User | undefined>;
  let backupService: {
    export: ReturnType<typeof vi.fn>;
    preview: ReturnType<typeof vi.fn>;
    restore: ReturnType<typeof vi.fn>;
  };
  let identityApi: {
    totpStatus: ReturnType<typeof vi.fn>;
    startTotpEnrollment: ReturnType<typeof vi.fn>;
    enableTotp: ReturnType<typeof vi.fn>;
    disableTotp: ReturnType<typeof vi.fn>;
    regenerateBackupCodes: ReturnType<typeof vi.fn>;
  };
  let agentChatRepo: {
    mintMcpToken: ReturnType<typeof vi.fn>;
    getInstructions: ReturnType<typeof vi.fn>;
    saveInstructions: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    fragment = new BehaviorSubject<string | null>(null);
    sessionUser = signal<User | undefined>(undefined);
    backupService = { export: vi.fn(), preview: vi.fn(), restore: vi.fn() };
    agentChatRepo = {
      mintMcpToken: vi
        .fn()
        .mockReturnValue(of({ token: 'mcp-secret', expiresAt: '2026-09-01T00:00:00Z' })),
      getInstructions: vi.fn().mockReturnValue(of('')),
      saveInstructions: vi.fn().mockReturnValue(of('')),
    };
    // Stubbed rather than injected `{ optional: true }`: IdentityApiService is
    // providedIn:'root', so it would always resolve and then fail on HttpClient.
    identityApi = {
      totpStatus: vi.fn().mockReturnValue(of({ enabled: false, backupCodesRemaining: 0 })),
      startTotpEnrollment: vi
        .fn()
        .mockReturnValue(of({ secret: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/x' })),
      enableTotp: vi.fn().mockReturnValue(of(['aaaa-1111', 'bbbb-2222'])),
      disableTotp: vi.fn().mockReturnValue(of(undefined)),
      regenerateBackupCodes: vi.fn().mockReturnValue(of(['cccc-3333'])),
    };
    await TestBed.configureTestingModule({
      imports: [
        Settings,
        provideTestTransloco(),
      ],
      providers: [
        provideZonelessChangeDetection(),
        provideTestTranslocoLocale(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { fragment: fragment.asObservable(), snapshot: { fragment: null } },
        },
        { provide: SessionService, useValue: { user: sessionUser.asReadonly() } },
        { provide: BackupService, useValue: backupService },
        { provide: IdentityApiService, useValue: identityApi },
        { provide: AgentChatRepository, useValue: agentChatRepo },
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
      aiChatEnabled: false,
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

  it('shows MCP access to administrators regardless of the stored chat flag', () => {
    sessionUser.set({
      id: 'admin-id',
      email: 'admin@example.com',
      displayName: 'Admin',
      role: 'admin',
      isActive: true,
      aiChatEnabled: false,
      createdAt: '',
    });

    const fixture = TestBed.createComponent(Settings);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Token de acesso MCP');
  });

  it('hides provider management from members', () => {
    sessionUser.set({
      id: 'member-id',
      email: 'member@example.com',
      displayName: 'Member',
      role: 'member',
      isActive: true,
      aiChatEnabled: false,
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

  it('renders the language, display-currency, and two-factor controls', () => {
    const fixture = TestBed.createComponent(Settings);
    fixture.detectChanges();

    // Deliberately no app-card count here: it breaks every time a section is
    // added (as the backup card did) without telling us anything. The control
    // ids below are what the page actually has to render.
    expect(fixture.nativeElement.querySelector('#settings-language')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#settings-display-currency')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#settings-two-factor')).not.toBeNull();
  });

  it('switches the theme when a theme button is clicked', () => {
    const fixture = TestBed.createComponent(Settings);
    fixture.detectChanges();

    const darkButton = fixture.nativeElement
      .querySelector('app-icon[name="moon"]')
      ?.closest('button') as HTMLButtonElement;
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
    ['settings-two-factor', 'settings-two-factor'],
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

  it('warns about unrecoverable lockout while two-factor is off', () => {
    const fixture = TestBed.createComponent(Settings);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('p[class*="border-warning"]')).not.toBeNull();
  });

  it('shows the QR code and the manual key when enrollment starts', () => {
    const fixture = TestBed.createComponent(Settings);
    fixture.detectChanges();

    fixture.componentInstance['startTotpEnrollment']();
    fixture.detectChanges();

    const qr = fixture.nativeElement.querySelector('img[src^="data:image/gif"]');
    expect(qr).not.toBeNull();
    expect(fixture.componentInstance['totpSetup']()?.secret).toBe('JBSWY3DPEHPK3PXP');
  });

  it('shows the backup codes once after confirming enrollment', () => {
    const fixture = TestBed.createComponent(Settings);
    fixture.detectChanges();
    fixture.componentInstance['startTotpEnrollment']();
    fixture.detectChanges();

    fixture.componentInstance['setTotpCode']('123456');
    fixture.componentInstance['confirmTotp']();
    fixture.detectChanges();

    expect(identityApi.enableTotp).toHaveBeenCalledWith('123456');
    expect(fixture.componentInstance['backupCodes']()).toEqual(['aaaa-1111', 'bbbb-2222']);

    // Dismissing is one-way: nothing can render them again. Assert the secret
    // is gone from the DOM too, not just from the signal - this is the
    // guarantee that actually matters, and a stale template binding would
    // keep it on screen with the signal already cleared.
    fixture.componentInstance['dismissBackupCodes']();
    fixture.detectChanges();
    expect(fixture.componentInstance['backupCodes']()).toBeUndefined();
    expect(fixture.nativeElement.textContent).not.toContain('aaaa-1111');
  });

  it('surfaces the backend error code when a code is rejected', () => {
    identityApi.disableTotp.mockReturnValue(throwError(() => ({ code: 'auth.totp_invalid' })));
    identityApi.totpStatus.mockReturnValue(of({ enabled: true, backupCodesRemaining: 10 }));
    const fixture = TestBed.createComponent(Settings);
    fixture.detectChanges();

    fixture.componentInstance['setTotpCode']('000000');
    fixture.componentInstance['disableTotp']();
    fixture.detectChanges();

    const alert = fixture.nativeElement.querySelector('[role="alert"]') as HTMLElement;
    expect(fixture.componentInstance['totpErrorCode']()).toBe('auth.totp_invalid');
    expect(alert).toBeTruthy();
  });

  // --- Custom AI instructions ---

  const asAdmin = (): void =>
    sessionUser.set({
      id: 'admin-id',
      email: 'admin@example.com',
      displayName: 'Admin',
      role: 'admin',
      isActive: true,
      aiChatEnabled: false,
      createdAt: '',
    });

  it('loads the stored AI instructions into the editor', () => {
    asAdmin();
    agentChatRepo.getInstructions.mockReturnValue(of('Sempre em BRL.'));

    const fixture = TestBed.createComponent(Settings);
    fixture.detectChanges();

    expect(fixture.componentInstance['aiInstructions']()).toBe('Sempre em BRL.');
    const textarea = fixture.nativeElement.querySelector(
      '#settings-ai-instructions',
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe('Sempre em BRL.');
  });

  it('blocks saving when stored AI instructions fail to load', () => {
    asAdmin();
    agentChatRepo.getInstructions.mockReturnValue(throwError(() => new Error('temporary failure')));

    const fixture = TestBed.createComponent(Settings);
    fixture.detectChanges();

    expect(fixture.componentInstance['aiInstructionsLoadError']()).toBe(true);
    const saveButton = fixture.nativeElement
      .querySelector('#settings-ai-instructions')
      .closest('app-card')
      .querySelector('button') as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
  });

  it('does not request AI instructions for a member without chat access', () => {
    sessionUser.set({
      id: 'member-id',
      email: 'member@example.com',
      displayName: 'Member',
      role: 'member',
      isActive: true,
      aiChatEnabled: false,
      createdAt: '',
    });

    const fixture = TestBed.createComponent(Settings);
    fixture.detectChanges();

    expect(agentChatRepo.getInstructions).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('#settings-ai-instructions')).toBeNull();
  });

  it('saves accepted AI instructions', () => {
    asAdmin();
    agentChatRepo.saveInstructions.mockReturnValue(of('Respostas curtas.'));
    const fixture = TestBed.createComponent(Settings);
    fixture.detectChanges();

    fixture.componentInstance['setAiInstructions']('Respostas curtas.');
    fixture.componentInstance['saveAiInstructions']();
    fixture.detectChanges();

    expect(agentChatRepo.saveInstructions).toHaveBeenCalledWith('Respostas curtas.');
    expect(fixture.componentInstance['aiInstructionsSaved']()).toBe(true);
    expect(fixture.componentInstance['aiInstructionsErrorCode']()).toBeUndefined();
  });

  it('warns with the backend reason when AI instructions are refused, keeping the text to edit', () => {
    asAdmin();
    agentChatRepo.saveInstructions.mockReturnValue(
      throwError(
        () =>
          new ApiError(422, 'agents.instructions_rejected', {
            reason: 'Não é sobre suas finanças.',
          }),
      ),
    );
    const fixture = TestBed.createComponent(Settings);
    fixture.detectChanges();

    fixture.componentInstance['setAiInstructions']('Escreva um poema.');
    fixture.componentInstance['saveAiInstructions']();
    fixture.detectChanges();

    expect(fixture.componentInstance['aiInstructionsErrorCode']()).toBe(
      'agents.instructions_rejected',
    );
    expect(fixture.componentInstance['aiInstructionsSaved']()).toBe(false);
    // Refused text is never stored, so the editor keeps it for the user to fix.
    expect(fixture.componentInstance['aiInstructions']()).toBe('Escreva um poema.');
    expect(fixture.nativeElement.textContent).toContain('Não é sobre suas finanças.');
  });
});
