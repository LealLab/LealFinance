import {
  Component,
  ElementRef,
  PendingTasks,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { firstValueFrom, Observable } from 'rxjs';
import { ApiError } from '../../core/api-error';
import { IdentityApiService } from '../../core/identity-api.service';
import { TotpSetup, TotpStatus, userInitials } from '../../core/identity.models';
import { SessionService } from '../../core/session.service';
import { Button } from '../../shared/ui/button/button';
import { Card } from '../../shared/ui/card/card';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { PasskeysSection } from '../settings/passkeys-section';

const notBlank = (control: AbstractControl) => (control.value.trim() ? null : { required: true });

@Component({
  selector: 'app-profile',
  imports: [ReactiveFormsModule, TranslocoDirective, Button, Card, PageHeader, PasskeysSection],
  templateUrl: './profile.html',
  styleUrl: './profile.scss',
})
export class Profile {
  protected readonly session = inject(SessionService);
  private readonly identityApi = inject(IdentityApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly pendingTasks = inject(PendingTasks);

  protected readonly profileForm = new FormGroup({
    displayName: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, notBlank],
    }),
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email],
    }),
    currentPassword: new FormControl('', { nonNullable: true }),
  });
  protected readonly passwordForm = new FormGroup({
    currentPassword: new FormControl('', { nonNullable: true, validators: Validators.required }),
    newPassword: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(12)],
    }),
  });
  protected readonly profileBusy = signal(false);
  protected readonly profileSaved = signal(false);
  protected readonly profileErrorCode = signal<string | undefined>(undefined);
  protected readonly passwordBusy = signal(false);
  protected readonly passwordSaved = signal(false);
  protected readonly passwordErrorCode = signal<string | undefined>(undefined);

  protected readonly totp = signal<TotpStatus | undefined>(undefined);
  protected readonly totpSetup = signal<(TotpSetup & { qrDataUrl: string }) | undefined>(undefined);
  protected readonly backupCodes = signal<string[] | undefined>(undefined);
  protected readonly totpCode = signal('');
  protected readonly totpBusy = signal(false);
  protected readonly totpErrorCode = signal<string | undefined>(undefined);
  protected readonly backupCodesCopied = signal(false);

  private readonly fragment = toSignal(this.route.fragment, {
    initialValue: this.route.snapshot.fragment,
  });
  private readonly twoFactorSection = viewChild<ElementRef<HTMLElement>>('twoFactorSection');
  private readonly passkeysSection = viewChild<ElementRef<HTMLElement>>('passkeysSection');

  protected readonly initials = () => userInitials(this.session.user());

  constructor() {
    this.loadTotpStatus();
    effect(() => {
      const user = this.session.user();
      if (!user) return;
      this.profileForm.patchValue(
        { displayName: user.displayName, email: user.email },
        { emitEvent: false },
      );
    });
    effect(() => {
      const target =
        this.fragment() === 'profile-two-factor'
          ? this.twoFactorSection()?.nativeElement
          : this.fragment() === 'profile-passkeys'
            ? this.passkeysSection()?.nativeElement
            : undefined;
      if (!target) return;
      target.scrollIntoView?.({ block: 'center' });
      target.focus();
    });
  }

  protected emailChanged(): boolean {
    const email = this.session.user()?.email;
    return (
      !!email && this.profileForm.controls.email.value.trim().toLowerCase() !== email.toLowerCase()
    );
  }

  protected async saveProfile(): Promise<void> {
    this.profileForm.markAllAsTouched();
    if (
      this.profileForm.invalid ||
      (this.emailChanged() && !this.profileForm.controls.currentPassword.value)
    ) {
      return;
    }
    const { displayName, email, currentPassword } = this.profileForm.getRawValue();
    this.profileBusy.set(true);
    this.profileSaved.set(false);
    this.profileErrorCode.set(undefined);
    try {
      await firstValueFrom(
        this.session.updateProfile({
          displayName: displayName.trim(),
          email: email.trim(),
          ...(this.emailChanged() ? { currentPassword } : {}),
        }),
      );
      this.profileForm.controls.currentPassword.reset('');
      this.profileSaved.set(true);
    } catch (error) {
      this.profileErrorCode.set(this.codeOf(error));
    } finally {
      this.profileBusy.set(false);
    }
  }

  protected async changePassword(): Promise<void> {
    this.passwordForm.markAllAsTouched();
    if (this.passwordForm.invalid) return;
    const { currentPassword, newPassword } = this.passwordForm.getRawValue();
    this.passwordBusy.set(true);
    this.passwordSaved.set(false);
    this.passwordErrorCode.set(undefined);
    try {
      await firstValueFrom(this.session.changePassword(currentPassword, newPassword));
      this.passwordForm.reset();
      this.passwordSaved.set(true);
    } catch (error) {
      this.passwordErrorCode.set(this.codeOf(error));
    } finally {
      this.passwordBusy.set(false);
    }
  }

  protected setTotpCode(value: string): void {
    this.totpCode.set(value);
  }

  protected startTotpEnrollment(): void {
    this.runTotpAction(this.identityApi.startTotpEnrollment(), async (setup) => {
      const qrcode = (await import('qrcode-generator')).default;
      const qr = qrcode(0, 'M');
      qr.addData(setup.otpauthUri);
      qr.make();
      this.totpSetup.set({ ...setup, qrDataUrl: qr.createDataURL(6, 2) });
    });
  }

  protected cancelTotpEnrollment(): void {
    this.totpSetup.set(undefined);
    this.totpCode.set('');
    this.totpErrorCode.set(undefined);
  }

  protected confirmTotp(): void {
    const code = this.totpCode().trim();
    if (!code) return;
    this.runTotpAction(this.identityApi.enableTotp(code), (codes) => {
      this.totpSetup.set(undefined);
      this.showBackupCodes(codes);
      this.loadTotpStatus();
    });
  }

  protected regenerateBackupCodes(): void {
    const code = this.totpCode().trim();
    if (!code) return;
    this.runTotpAction(this.identityApi.regenerateBackupCodes(code), (codes) => {
      this.showBackupCodes(codes);
      this.loadTotpStatus();
    });
  }

  protected disableTotp(): void {
    const code = this.totpCode().trim();
    if (!code) return;
    this.runTotpAction(this.identityApi.disableTotp(code), () => {
      this.backupCodes.set(undefined);
      this.loadTotpStatus();
    });
  }

  protected dismissBackupCodes(): void {
    this.backupCodes.set(undefined);
    this.backupCodesCopied.set(false);
  }

  protected copyBackupCodes(): void {
    const codes = this.backupCodes();
    if (!codes) return;
    void navigator.clipboard?.writeText(codes.join('\n'));
    this.backupCodesCopied.set(true);
  }

  private showBackupCodes(codes: string[]): void {
    this.backupCodes.set(codes);
    this.backupCodesCopied.set(false);
  }

  private runTotpAction<T>(
    request: Observable<T>,
    onSuccess: (value: T) => void | Promise<void>,
  ): void {
    this.totpBusy.set(true);
    this.totpErrorCode.set(undefined);
    request.subscribe({
      next: (value) => {
        this.totpCode.set('');
        const done = this.pendingTasks.add();
        Promise.resolve(onSuccess(value)).finally(() => {
          this.totpBusy.set(false);
          done();
        });
      },
      error: (error: unknown) => {
        this.totpErrorCode.set(this.codeOf(error));
        this.totpBusy.set(false);
      },
    });
  }

  private loadTotpStatus(): void {
    this.identityApi.totpStatus().subscribe({
      next: (status) => this.totp.set(status),
      error: () => this.totp.set(undefined),
    });
  }

  private codeOf(error: unknown): string {
    return error instanceof ApiError ? error.code : 'error.generic';
  }
}
