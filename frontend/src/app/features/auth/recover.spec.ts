import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { IdentityApiService } from '../../core/identity-api.service';
import { Recover } from './recover';
import { provideTestTransloco } from '../../../testing/transloco';

const VALID = {
  email: 'user@example.com',
  code: '123456',
  newPassword: 'a sufficiently long password',
};

describe('Recover', () => {
  let identityApi: { recover: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    identityApi = { recover: vi.fn().mockReturnValue(of(undefined)) };
    await TestBed.configureTestingModule({
      imports: [
        Recover,
        provideTestTransloco(),
      ],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: IdentityApiService, useValue: identityApi },
      ],
    }).compileComponents();
  });

  it('rejects a new password shorter than the registration minimum', () => {
    const fixture = TestBed.createComponent(Recover);
    fixture.detectChanges();

    fixture.componentInstance['form'].patchValue({ ...VALID, newPassword: 'short' });
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector(
      'button[type="submit"]',
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('resets the password and confirms the user was signed out everywhere', async () => {
    const fixture = TestBed.createComponent(Recover);
    fixture.detectChanges();

    fixture.componentInstance['form'].patchValue(VALID);
    await fixture.componentInstance['submit']();
    fixture.detectChanges();

    expect(identityApi.recover).toHaveBeenCalledWith(VALID.email, VALID.code, VALID.newPassword);
    expect(fixture.componentInstance['done']()).toBe(true);
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
  });

  it('shows the opaque failure the backend returns for a bad code', async () => {
    identityApi.recover.mockReturnValue(throwError(() => ({ code: 'auth.invalid_credentials' })));
    const fixture = TestBed.createComponent(Recover);
    fixture.detectChanges();

    fixture.componentInstance['form'].patchValue(VALID);
    await fixture.componentInstance['submit']();
    fixture.detectChanges();

    const alert = fixture.nativeElement.querySelector('[role="alert"]') as HTMLElement;
    expect(fixture.componentInstance['errorCode']()).toBe('auth.invalid_credentials');
    expect(alert).toBeTruthy();
    expect(fixture.componentInstance['done']()).toBe(false);
  });

  it('sends the user to the login page once the reset is done', async () => {
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(Recover);
    fixture.detectChanges();

    fixture.componentInstance['form'].patchValue(VALID);
    await fixture.componentInstance['submit']();
    await fixture.componentInstance['goToLogin']();

    expect(navigateSpy).toHaveBeenCalledWith('/login');
  });
});
