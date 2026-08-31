import { signal, WritableSignal } from '@angular/core';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { IdentityApiService } from '../../core/identity-api.service';
import { User } from '../../core/identity.models';
import { DisplayCurrencyService } from '../../core/display-currency.service';
import { MetadataService } from '../../core/metadata.service';
import { SessionService } from '../../core/session.service';
import { Settings } from './settings';
import ptBR from '../../../../public/i18n/pt-BR.json';

describe('Settings', () => {
  let fragment: BehaviorSubject<string | null>;
  let sessionUser: WritableSignal<User | undefined>;
  let identityApi: {
    totpStatus: ReturnType<typeof vi.fn>;
    startTotpEnrollment: ReturnType<typeof vi.fn>;
    enableTotp: ReturnType<typeof vi.fn>;
    disableTotp: ReturnType<typeof vi.fn>;
    regenerateBackupCodes: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    fragment = new BehaviorSubject<string | null>(null);
    sessionUser = signal<User | undefined>(undefined);
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
        TranslocoTestingModule.forRoot({
          langs: { 'pt-BR': ptBR },
          translocoConfig: { availableLangs: ['pt-BR'], defaultLang: 'pt-BR' },
        }),
      ],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { fragment: fragment.asObservable(), snapshot: { fragment: null } },
        },
        { provide: SessionService, useValue: { user: sessionUser.asReadonly() } },
        { provide: IdentityApiService, useValue: identityApi },
      ],
    }).compileComponents();
    TestBed.inject(MetadataService).currencies.set([
      { code: 'BRL', name: 'Real', symbol: 'R$', decimalDigits: 2, isActive: true },
      { code: 'USD', name: 'US Dollar', symbol: '$', decimalDigits: 2, isActive: true },
    ]);
  });

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
    ['settings-two-factor', 'settings-two-factor'],
  ])('focuses the %s control when its route fragment becomes active', (routeFragment, id) => {
    const fixture = TestBed.createComponent(Settings);
    fixture.detectChanges();

    fragment.next(routeFragment);
    fixture.detectChanges();

    expect(document.activeElement).toBe(fixture.nativeElement.querySelector(`#${id}`));
  });

  it('warns about unrecoverable lockout while two-factor is off', () => {
    const fixture = TestBed.createComponent(Settings);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Autenticação de dois fatores');
    expect(text).toContain('não há como recuperar sua conta');
  });

  it('shows the QR code and the manual key when enrollment starts', () => {
    const fixture = TestBed.createComponent(Settings);
    fixture.detectChanges();

    fixture.componentInstance['startTotpEnrollment']();
    fixture.detectChanges();

    const qr = fixture.nativeElement.querySelector('img[src^="data:image/gif"]');
    expect(qr).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('JBSWY3DPEHPK3PXP');
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
    expect(fixture.nativeElement.textContent).toContain('aaaa-1111');

    // Dismissing is one-way: nothing can render them again.
    fixture.componentInstance['dismissBackupCodes']();
    fixture.detectChanges();
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
    expect(alert.textContent).toContain('Esse código não é válido');
  });
});
