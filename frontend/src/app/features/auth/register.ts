import { Component, effect, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { IdentityApiService } from '../../core/identity-api.service';
import { CurrencyMetadata } from '../../core/identity.models';
import { SessionService } from '../../core/session.service';
import { Button } from '../../shared/ui/button/button';
import { CurrencySelect } from '../../shared/ui/currency-select/currency-select';
import { LanguageSelect } from '../../shared/ui/language-select/language-select';
import { Logo } from '../../shared/ui/logo/logo';
import { ThemeToggle } from '../../shared/ui/theme-toggle/theme-toggle';

@Component({
  selector: 'app-register',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    TranslocoDirective,
    Button,
    CurrencySelect,
    Logo,
    LanguageSelect,
    ThemeToggle,
  ],
  templateUrl: './register.html',
})
export class Register {
  private readonly session = inject(SessionService);
  private readonly identityApi = inject(IdentityApiService);
  private readonly transloco = inject(TranslocoService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly submitting = signal(false);
  protected readonly errorCode = signal<string | undefined>(undefined);
  /** True while this instance has no users yet - the first registration
   * becomes the administrator and needs no invitation token. */
  protected readonly needsSetup = signal(false);
  /** Fetched directly rather than through MetadataService - there is no
   * session yet on this page, so SessionService.ensureLoaded (the only
   * caller of MetadataService.hydrate()) never runs here. Passed to
   * app-currency-select's `currencies` override input below. */
  protected readonly currencies = signal<CurrencyMetadata[]>([]);
  private readonly activeLang = toSignal(this.transloco.langChanges$, {
    initialValue: this.transloco.getActiveLang(),
  });
  protected readonly form = new FormGroup({
    displayName: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    email: new FormControl(this.route.snapshot.queryParamMap.get('email') ?? '', {
      nonNullable: true,
      validators: [Validators.required, Validators.email],
    }),
    token: new FormControl(this.route.snapshot.queryParamMap.get('token') ?? '', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    password: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(12)],
    }),
    baseCurrency: new FormControl('USD', { nonNullable: true, validators: [Validators.required] }),
    locale: new FormControl(this.transloco.getActiveLang(), {
      nonNullable: true,
      validators: [Validators.required],
    }),
  });

  constructor() {
    effect(() => {
      const locale = this.activeLang();
      if (this.form.controls.locale.value !== locale) {
        this.form.controls.locale.setValue(locale, { emitEvent: false });
      }
    });
    this.identityApi.currencies().subscribe(
      (currencies) => this.currencies.set(currencies),
      (error: unknown) => this.errorCode.set(this.readCode(error)),
    );
    this.identityApi.setupStatus().subscribe({
      next: (needed) => {
        if (!needed) return;
        this.needsSetup.set(true);
        this.form.controls.token.removeValidators(Validators.required);
        this.form.controls.token.updateValueAndValidity();
      },
      error: (error: unknown) => this.errorCode.set(this.readCode(error)),
    });
  }

  protected async submit(): Promise<void> {
    if (this.form.invalid || this.submitting()) return;
    this.submitting.set(true);
    this.errorCode.set(undefined);
    try {
      await firstValueFrom(this.session.register(this.form.getRawValue()));
      await this.router.navigateByUrl('/');
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
