import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { IdentityApiService } from '../../core/identity-api.service';
import { SessionService } from '../../core/session.service';
import { Button } from '../../shared/ui/button/button';
import { Logo } from '../../shared/ui/logo/logo';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, RouterLink, TranslocoDirective, Button, Logo],
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
  protected readonly form = new FormGroup({
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email],
    }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
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
      const { email, password } = this.form.getRawValue();
      await firstValueFrom(this.session.login(email, password));
      const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') || '/';
      await this.router.navigateByUrl(returnUrl);
    } catch (error) {
      this.errorCode.set(this.readCode(error));
    } finally {
      this.submitting.set(false);
    }
  }

  private readCode(error: unknown): string {
    return typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : 'error.generic';
  }
}
