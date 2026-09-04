import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { IdentityApiService } from '../../core/identity-api.service';
import { Button } from '../../shared/ui/button/button';
import { LanguageSelect } from '../../shared/ui/language-select/language-select';
import { Logo } from '../../shared/ui/logo/logo';
import { ThemeToggle } from '../../shared/ui/theme-toggle/theme-toggle';

/**
 * Password reset for a user who still has their authenticator (or a backup
 * code) but has lost the password. Deliberately issues no session: the reset
 * revokes every session and trusted device server-side, so the user signs in
 * again from scratch.
 */
@Component({
  selector: 'app-recover',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    TranslocoDirective,
    Button,
    Logo,
    LanguageSelect,
    ThemeToggle,
  ],
  templateUrl: './recover.html',
})
export class Recover {
  private readonly identityApi = inject(IdentityApiService);
  private readonly router = inject(Router);

  protected readonly submitting = signal(false);
  protected readonly errorCode = signal<string | undefined>(undefined);
  protected readonly done = signal(false);
  protected readonly form = new FormGroup({
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email],
    }),
    code: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    // Mirrors RegisterRequest's min_length=12 so the rule is enforced before
    // the round trip as well as by the backend.
    newPassword: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(12)],
    }),
  });

  protected async submit(): Promise<void> {
    if (this.form.invalid || this.submitting()) return;
    this.submitting.set(true);
    this.errorCode.set(undefined);
    try {
      const { email, code, newPassword } = this.form.getRawValue();
      await firstValueFrom(this.identityApi.recover(email, code, newPassword));
      this.done.set(true);
    } catch (error) {
      this.errorCode.set(this.readCode(error));
    } finally {
      this.submitting.set(false);
    }
  }

  protected async goToLogin(): Promise<void> {
    await this.router.navigateByUrl('/login');
  }

  private readCode(error: unknown): string {
    return typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : 'error.generic';
  }
}
