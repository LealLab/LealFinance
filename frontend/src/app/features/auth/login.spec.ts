import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { of, throwError } from 'rxjs';
import { IdentityApiService } from '../../core/identity-api.service';
import { SessionService } from '../../core/session.service';
import { Login } from './login';
import ptBR from '../../../../public/i18n/pt-BR.json';

describe('Login', () => {
  let session: { login: ReturnType<typeof vi.fn> };
  let identityApi: { setupStatus: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    session = { login: vi.fn().mockReturnValue(of({ id: 'u1' })) };
    identityApi = { setupStatus: vi.fn().mockReturnValue(of(false)) };
    await TestBed.configureTestingModule({
      imports: [
        Login,
        TranslocoTestingModule.forRoot({
          langs: { 'pt-BR': ptBR },
          translocoConfig: { availableLangs: ['pt-BR'], defaultLang: 'pt-BR' },
        }),
      ],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: SessionService, useValue: session },
        { provide: IdentityApiService, useValue: identityApi },
      ],
    }).compileComponents();
  });

  it('redirects to /register when the instance has no users yet', () => {
    identityApi.setupStatus.mockReturnValue(of(true));
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    TestBed.createComponent(Login).detectChanges();

    expect(navigateSpy).toHaveBeenCalledWith('/register');
  });

  it('keeps the submit button disabled until email and password are both valid', () => {
    const fixture = TestBed.createComponent(Login);
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector(
      'button[type="submit"]',
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    fixture.componentInstance['form'].patchValue({ email: 'not-an-email', password: 'secret' });
    fixture.detectChanges();
    expect(button.disabled).toBe(true);

    fixture.componentInstance['form'].patchValue({ email: 'user@example.com', password: 'secret' });
    fixture.detectChanges();
    expect(button.disabled).toBe(false);
  });

  it('logs in and navigates to the returnUrl on success', async () => {
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(Login);
    fixture.detectChanges();

    fixture.componentInstance['form'].patchValue({ email: 'user@example.com', password: 'secret' });
    await fixture.componentInstance['submit']();

    expect(session.login).toHaveBeenCalledWith('user@example.com', 'secret', undefined);
    expect(navigateSpy).toHaveBeenCalledWith('/');
  });

  it('shows the translated backend error code on a failed login', async () => {
    session.login.mockReturnValue(throwError(() => ({ code: 'auth.invalid_credentials' })));
    const fixture = TestBed.createComponent(Login);
    fixture.detectChanges();

    fixture.componentInstance['form'].patchValue({ email: 'user@example.com', password: 'wrong' });
    await fixture.componentInstance['submit']();
    fixture.detectChanges();

    const alert = fixture.nativeElement.querySelector('[role="alert"]') as HTMLElement;
    expect(alert).toBeTruthy();
    expect(fixture.componentInstance['errorCode']()).toBe('auth.invalid_credentials');
  });

  it('switches to the code prompt instead of showing an error on totp_required', async () => {
    session.login.mockReturnValue(throwError(() => ({ code: 'auth.totp_required' })));
    const fixture = TestBed.createComponent(Login);
    fixture.detectChanges();

    fixture.componentInstance['form'].patchValue({ email: 'user@example.com', password: 'secret' });
    await fixture.componentInstance['submit']();
    fixture.detectChanges();

    // The challenge is a step, not a failure - no alert should appear.
    expect(fixture.componentInstance['errorCode']()).toBeUndefined();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Verificação em duas etapas');
    expect(fixture.nativeElement.querySelector('input[type="checkbox"]')).not.toBeNull();
  });

  it('resends the credentials with the code and the trust choice', async () => {
    session.login.mockReturnValue(throwError(() => ({ code: 'auth.totp_required' })));
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(Login);
    fixture.detectChanges();

    fixture.componentInstance['form'].patchValue({ email: 'user@example.com', password: 'secret' });
    await fixture.componentInstance['submit']();

    session.login.mockReturnValue(of({ id: 'u1' }));
    fixture.componentInstance['form'].patchValue({ totpCode: '123456', trustDevice: true });
    await fixture.componentInstance['submit']();

    expect(session.login).toHaveBeenLastCalledWith('user@example.com', 'secret', {
      code: '123456',
      trustDevice: true,
    });
  });

  it('defaults to not trusting the device', async () => {
    session.login.mockReturnValue(throwError(() => ({ code: 'auth.totp_required' })));
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(Login);
    fixture.detectChanges();

    fixture.componentInstance['form'].patchValue({ email: 'user@example.com', password: 'secret' });
    await fixture.componentInstance['submit']();

    session.login.mockReturnValue(of({ id: 'u1' }));
    fixture.componentInstance['form'].patchValue({ totpCode: '123456' });
    await fixture.componentInstance['submit']();

    expect(session.login).toHaveBeenLastCalledWith('user@example.com', 'secret', {
      code: '123456',
      trustDevice: false,
    });
  });

  it('requires a code before the challenge can be submitted', async () => {
    session.login.mockReturnValue(throwError(() => ({ code: 'auth.totp_required' })));
    const fixture = TestBed.createComponent(Login);
    fixture.detectChanges();

    fixture.componentInstance['form'].patchValue({ email: 'user@example.com', password: 'secret' });
    await fixture.componentInstance['submit']();
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector(
      'button[type="submit"]',
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});
