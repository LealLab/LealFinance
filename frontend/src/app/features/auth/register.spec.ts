import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { of, throwError } from 'rxjs';
import { IdentityApiService } from '../../core/identity-api.service';
import { SessionService } from '../../core/session.service';
import { Register } from './register';
import { provideTestTransloco } from '../../../testing/transloco';

const CURRENCIES = [
  { code: 'USD', name: 'US Dollar', symbol: '$', decimalDigits: 2, isActive: true },
  { code: 'BRL', name: 'Real', symbol: 'R$', decimalDigits: 2, isActive: true },
];

describe('Register', () => {
  let session: { register: ReturnType<typeof vi.fn> };
  let identityApi: { currencies: ReturnType<typeof vi.fn>; setupInfo: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    session = { register: vi.fn().mockReturnValue(of({ id: 'u1' })) };
    identityApi = {
      currencies: vi.fn().mockReturnValue(of(CURRENCIES)),
      setupInfo: vi.fn().mockReturnValue(of({ needsSetup: false, setupTokenRequired: false })),
    };
    await TestBed.configureTestingModule({
      imports: [
        Register,
        provideTestTransloco(['en-US', 'pt-BR']),
      ],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: SessionService, useValue: session },
        { provide: IdentityApiService, useValue: identityApi },
      ],
    }).compileComponents();
  });

  it('requires an invitation token unless the instance still needs first-admin setup', () => {
    const fixture = TestBed.createComponent(Register);
    fixture.detectChanges();

    expect(fixture.componentInstance['form'].controls.token.validator).toBeTruthy();
    expect(fixture.nativeElement.querySelector('input[formcontrolname="token"]')).toBeTruthy();
  });

  it('drops the token requirement and hides its field when setup is needed', () => {
    identityApi.setupInfo.mockReturnValue(of({ needsSetup: true, setupTokenRequired: false }));
    const fixture = TestBed.createComponent(Register);
    fixture.detectChanges();

    expect(fixture.componentInstance['form'].controls.token.validator).toBeNull();
    expect(fixture.nativeElement.querySelector('input[formcontrolname="token"]')).toBeNull();
    // No SETUP_TOKEN on the server: the field is not asked for.
    expect(fixture.nativeElement.querySelector('#register-setup-token')).toBeNull();
    expect(fixture.componentInstance['form'].controls.setupToken.validator).toBeNull();
  });

  it('asks for the setup code only on a fresh instance that has one configured', () => {
    identityApi.setupInfo.mockReturnValue(of({ needsSetup: true, setupTokenRequired: true }));
    const fixture = TestBed.createComponent(Register);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#register-setup-token')).toBeTruthy();
    expect(fixture.componentInstance['form'].controls.setupToken.validator).toBeTruthy();
  });

  it('never shows the setup code field when setup is not needed', () => {
    // The server would not send this combination, but the page must not trust it.
    identityApi.setupInfo.mockReturnValue(of({ needsSetup: false, setupTokenRequired: true }));
    const fixture = TestBed.createComponent(Register);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#register-setup-token')).toBeNull();
  });

  it('sends the trimmed setup code with the first registration', async () => {
    identityApi.setupInfo.mockReturnValue(of({ needsSetup: true, setupTokenRequired: true }));
    vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(Register);
    fixture.detectChanges();

    fixture.componentInstance['form'].setValue({
      displayName: 'Ada Lovelace',
      email: 'ada@example.com',
      token: '',
      setupToken: '  code-from-env  ',
      password: 'a-very-long-password',
      baseCurrency: 'USD',
      locale: 'en-US',
    });
    await fixture.componentInstance['submit']();

    expect(session.register).toHaveBeenCalledWith(
      expect.objectContaining({ setupToken: 'code-from-env' }),
    );
  });

  it('blocks the submit until the setup code is entered', async () => {
    identityApi.setupInfo.mockReturnValue(of({ needsSetup: true, setupTokenRequired: true }));
    const fixture = TestBed.createComponent(Register);
    fixture.detectChanges();

    fixture.componentInstance['form'].patchValue({
      displayName: 'Ada Lovelace',
      email: 'ada@example.com',
      password: 'a-very-long-password',
    });
    await fixture.componentInstance['submit']();

    expect(session.register).not.toHaveBeenCalled();
  });

  it('shows a wrong setup code as a translated error', async () => {
    identityApi.setupInfo.mockReturnValue(of({ needsSetup: true, setupTokenRequired: true }));
    session.register.mockReturnValue(throwError(() => ({ code: 'auth.setup_token_invalid' })));
    const fixture = TestBed.createComponent(Register);
    fixture.detectChanges();
    fixture.componentInstance['form'].patchValue({
      displayName: 'Ada Lovelace',
      email: 'ada@example.com',
      setupToken: 'wrong',
      password: 'a-very-long-password',
    });

    await fixture.componentInstance['submit']();

    expect(fixture.componentInstance['errorCode']()).toBe('auth.setup_token_invalid');
  });

  it('populates currency options from the metadata endpoint', () => {
    const fixture = TestBed.createComponent(Register);
    fixture.detectChanges();

    const options = Array.from(
      fixture.nativeElement.querySelectorAll(
        'app-currency-select[formcontrolname="baseCurrency"] datalist option',
      ),
    ) as HTMLOptionElement[];
    expect(options.map((o) => o.value)).toEqual(['USD', 'BRL']);
  });

  it('defaults the submitted locale to the active language', () => {
    const fixture = TestBed.createComponent(Register);
    fixture.detectChanges();

    expect(fixture.componentInstance['form'].controls.locale.value).toBe('en-US');
  });

  it('follows the page language when it is switched from the card control', () => {
    const fixture = TestBed.createComponent(Register);
    fixture.detectChanges();

    const select = fixture.nativeElement.querySelector(
      'app-language-select select',
    ) as HTMLSelectElement;
    select.value = 'pt-BR';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(TestBed.inject(TranslocoService).getActiveLang()).toBe('pt-BR');
    expect(fixture.componentInstance['form'].controls.locale.value).toBe('pt-BR');
  });

  it('registers and navigates home on success', async () => {
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(Register);
    fixture.detectChanges();

    fixture.componentInstance['form'].setValue({
      displayName: 'Ada Lovelace',
      email: 'ada@example.com',
      token: 'invite-token',
      setupToken: '',
      password: 'a-very-long-password',
      baseCurrency: 'USD',
      locale: 'pt-BR',
    });
    await fixture.componentInstance['submit']();

    expect(session.register).toHaveBeenCalledWith({
      displayName: 'Ada Lovelace',
      email: 'ada@example.com',
      token: 'invite-token',
      password: 'a-very-long-password',
      baseCurrency: 'USD',
      locale: 'pt-BR',
    });
    expect(navigateSpy).toHaveBeenCalledWith('/');
  });

  it('shows the translated backend error code on a failed registration', async () => {
    session.register.mockReturnValue(throwError(() => ({ code: 'user.email_taken' })));
    const fixture = TestBed.createComponent(Register);
    fixture.detectChanges();

    fixture.componentInstance['form'].setValue({
      displayName: 'Ada Lovelace',
      email: 'ada@example.com',
      token: 'invite-token',
      setupToken: '',
      password: 'a-very-long-password',
      baseCurrency: 'USD',
      locale: 'pt-BR',
    });
    await fixture.componentInstance['submit']();
    fixture.detectChanges();

    expect(fixture.componentInstance['errorCode']()).toBe('user.email_taken');
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeTruthy();
  });
});
