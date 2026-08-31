import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { IdentityApiService, TOTP_REQUIRED } from '../../core/identity-api.service';
import { SessionService } from '../../core/session.service';
import { Button } from '../../shared/ui/button/button';
import { LanguageSelect } from '../../shared/ui/language-select/language-select';
import { Logo } from '../../shared/ui/logo/logo';
import { ThemeToggle } from '../../shared/ui/theme-toggle/theme-toggle';

@Component({
  selector: 'app-login',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    TranslocoDirective,
    Button,
    Logo,
    LanguageSelect,
    ThemeToggle,
  ],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login {
  private readonly session = inject(SessionService);
  private readonly identityApi = inject(IdentityApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly submitting = signal(false);
  protected readonly errorCode = signal<string | undefined>(undefined);
  /** True once the backend has answered auth.totp_required: the same form is
   * resubmitted to the same endpoint with the code filled in. */
  protected readonly challenging = signal(false);
  protected readonly form = new FormGroup({
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email],
    }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    totpCode: new FormControl('', { nonNullable: true }),
    trustDevice: new FormControl(false, { nonNullable: true }),
  });

  constructor() {
    // A fresh instance has no one to log in as yet - send whoever lands
    // here straight to registration, which becomes the admin bootstrap.
    this.identityApi.setupStatus().subscribe((needed) => {
      if (needed) void this.router.navigateByUrl('/register');
    });
  }

  protected async submit(): Promise<void> {
    if (this.form.invalid || this.submitting()) return;
    this.submitting.set(true);
    this.errorCode.set(undefined);
    try {
      const { email, password, totpCode, trustDevice } = this.form.getRawValue();
      const secondFactor = this.challenging() ? { code: totpCode, trustDevice } : undefined;
      await firstValueFrom(this.session.login(email, password, secondFactor));
      const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') || '/';
      await this.router.navigateByUrl(returnUrl);
    } catch (error) {
      const code = this.readCode(error);
      if (code === TOTP_REQUIRED) {
        this.beginChallenge();
        return;
      }
      this.errorCode.set(code);
    } finally {
      this.submitting.set(false);
    }
  }

  private beginChallenge(): void {
    this.challenging.set(true);
    this.form.controls.totpCode.addValidators(Validators.required);
    this.form.controls.totpCode.updateValueAndValidity();
  }

  private readCode(error: unknown): string {
    return typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : 'error.generic';
  }
}
