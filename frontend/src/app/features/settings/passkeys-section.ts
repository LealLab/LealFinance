import { Component, computed, inject, signal } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { TranslocoLocaleService } from '@jsverse/transloco-locale';
import { ApiError } from '../../core/api-error';
import { IdentityApiService } from '../../core/identity-api.service';
import { Passkey } from '../../core/identity.models';
import {
  isPasskeyCancellation,
  isPasskeySupported,
  requestPasskeyRegistration,
} from '../../core/webauthn';
import { Button } from '../../shared/ui/button/button';
import { Card } from '../../shared/ui/card/card';
import { PasswordConfirm } from '../../shared/ui/password-confirm/password-confirm';

/**
 * t(settings.passkeys.removeConfirm.title, settings.passkeys.removeConfirm.message,
 * settings.reauth.title, settings.reauth.description, errors.auth.invalid_credentials,
 * errors.auth.account_locked)
 *
 * Adding and removing a passkey both re-ask for the account password (the
 * server checks it), so a stolen session cannot plant or strip a sign-in method.
 */
@Component({
  selector: 'app-passkeys-section',
  imports: [TranslocoDirective, Button, Card, PasswordConfirm],
  templateUrl: './passkeys-section.html',
})
export class PasskeysSection {
  private readonly identityApi = inject(IdentityApiService);
  private readonly locale = inject(TranslocoLocaleService);

  protected readonly supported = isPasskeySupported();
  protected readonly passkeys = signal<Passkey[]>([]);
  protected readonly loadError = signal(false);
  protected readonly busy = signal(false);
  protected readonly errorCode = signal<string | undefined>(undefined);
  protected readonly adding = signal(false);
  protected readonly newName = signal('');
  protected readonly reauthOpen = signal(false);
  /** What the password dialog is for: adding, or removing one passkey. */
  private readonly reauthTarget = signal<'add' | Passkey | undefined>(undefined);
  protected readonly reauthError = signal<string | undefined>(undefined);
  protected readonly reauthTitleKey = computed(() =>
    this.isRemoving() ? 'settings.passkeys.removeConfirm.title' : 'settings.reauth.title',
  );
  protected readonly reauthMessageKey = computed(() =>
    this.isRemoving() ? 'settings.passkeys.removeConfirm.message' : 'settings.reauth.description',
  );

  constructor() {
    if (this.supported) this.loadPasskeys();
  }

  protected formatPasskeyDate(value: string): string {
    return this.locale.localizeDate(value, undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  protected startAdding(): void {
    this.errorCode.set(undefined);
    this.adding.set(true);
  }

  protected cancelAdding(): void {
    this.adding.set(false);
    this.newName.set('');
    this.errorCode.set(undefined);
  }

  /** "Create passkey" only asks for the password; the work starts in `onPassword`. */
  protected createPasskey(): void {
    if (!this.newName().trim() || this.busy()) return;
    this.openReauth('add');
  }

  protected removePasskey(passkey: Passkey): void {
    if (this.busy()) return;
    this.openReauth(passkey);
  }

  protected async onPassword(password: string): Promise<void> {
    const target = this.reauthTarget();
    if (!target || this.busy()) return;
    this.busy.set(true);
    this.reauthError.set(undefined);
    this.errorCode.set(undefined);
    try {
      if (target === 'add') {
        const opts = await firstValueFrom(this.identityApi.passkeyRegisterOptions(password));
        const credential = await requestPasskeyRegistration(opts);
        await firstValueFrom(
          this.identityApi.registerPasskey(this.newName().trim(), opts.challenge, credential, password),
        );
        this.cancelAdding();
      } else {
        await firstValueFrom(this.identityApi.deletePasskey(target.id, password));
      }
      this.reauthOpen.set(false);
      this.loadPasskeys();
    } catch (error) {
      if (isPasskeyCancellation(error)) {
        this.reauthOpen.set(false);
        this.cancelAdding();
        return;
      }
      const code = error instanceof ApiError ? error.code : 'error.generic';
      if (code === 'auth.invalid_credentials' || code === 'auth.account_locked') {
        // A wrong password is answered inside the dialog, which stays open.
        this.reauthError.set(`errors.${code}`);
      } else {
        this.reauthOpen.set(false);
        this.errorCode.set(code);
      }
    } finally {
      this.busy.set(false);
    }
  }

  private isRemoving(): boolean {
    const target = this.reauthTarget();
    return target !== undefined && target !== 'add';
  }

  private openReauth(target: 'add' | Passkey): void {
    this.reauthTarget.set(target);
    this.reauthError.set(undefined);
    this.errorCode.set(undefined);
    this.reauthOpen.set(true);
  }

  private loadPasskeys(): void {
    this.identityApi.listPasskeys().subscribe({
      next: (passkeys) => {
        this.passkeys.set(passkeys);
        this.loadError.set(false);
      },
      error: () => this.loadError.set(true),
    });
  }
}
