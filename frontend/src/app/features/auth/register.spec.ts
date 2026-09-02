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
  let identityApi: { currencies: ReturnType<typeof vi.fn>; setupStatus: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    session = { register: vi.fn().mockReturnValue(of({ id: 'u1' })) };
    identityApi = {
      currencies: vi.fn().mockReturnValue(of(CURRENCIES)),
      setupStatus: vi.fn().mockReturnValue(of(false)),
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
    identityApi.setupStatus.mockReturnValue(of(true));
    const fixture = TestBed.createComponent(Register);
    fixture.detectChanges();

    expect(fixture.componentInstance['form'].controls.token.validator).toBeNull();
    expect(fixture.nativeElement.querySelector('input[formcontrolname="token"]')).toBeNull();
  });

  it('populates currency options from the metadata endpoint', () => {
    const fixture = TestBed.createComponent(Register);
    fixture.detectChanges();

    const options = Array.from(
      fixture.nativeElement.querySelectorAll('select[formcontrolname="baseCurrency"] option'),
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
