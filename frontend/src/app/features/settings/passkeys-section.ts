import { Component, inject, signal } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { TranslocoLocaleService } from '@jsverse/transloco-locale';
import { ApiError } from '../../core/api-error';
import { ConfirmService } from '../../core/confirm.service';
import { IdentityApiService } from '../../core/identity-api.service';
import { Passkey } from '../../core/identity.models';
import {
  isPasskeyCancellation,
  isPasskeySupported,
  requestPasskeyRegistration,
} from '../../core/webauthn';
import { Button } from '../../shared/ui/button/button';
import { Card } from '../../shared/ui/card/card';

/** t(settings.passkeys.removeConfirm.title, settings.passkeys.removeConfirm.message) */
@Component({
  selector: 'app-passkeys-section',
  imports: [TranslocoDirective, Button, Card],
  templateUrl: './passkeys-section.html',
  styleUrl: './passkeys-section.scss',
})
export class PasskeysSection {
  private readonly identityApi = inject(IdentityApiService);
  private readonly confirm = inject(ConfirmService);
  private readonly locale = inject(TranslocoLocaleService);

  protected readonly supported = isPasskeySupported();
  protected readonly passkeys = signal<Passkey[]>([]);
  protected readonly loadError = signal(false);
  protected readonly busy = signal(false);
  protected readonly errorCode = signal<string | undefined>(undefined);
  protected readonly adding = signal(false);
  protected readonly newName = signal('');

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

  protected async createPasskey(): Promise<void> {
    const name = this.newName().trim();
    if (!name || this.busy()) return;
    this.busy.set(true);
    this.errorCode.set(undefined);
    try {
      const opts = await firstValueFrom(this.identityApi.passkeyRegisterOptions());
      const credential = await requestPasskeyRegistration(opts);
      await firstValueFrom(this.identityApi.registerPasskey(name, opts.challenge, credential));
      this.cancelAdding();
      this.loadPasskeys();
    } catch (error) {
      if (isPasskeyCancellation(error)) {
        this.cancelAdding();
        return;
      }
      this.errorCode.set(error instanceof ApiError ? error.code : 'error.generic');
    } finally {
      this.busy.set(false);
    }
  }

  protected async removePasskey(passkey: Passkey): Promise<void> {
    if (
      this.busy() ||
      !(await this.confirm.confirm(
        'settings.passkeys.removeConfirm.title',
        'settings.passkeys.removeConfirm.message',
        'danger',
      ))
    ) {
      return;
    }
    this.busy.set(true);
    this.errorCode.set(undefined);
    try {
      await firstValueFrom(this.identityApi.deletePasskey(passkey.id));
      this.loadPasskeys();
    } catch (error) {
      this.errorCode.set(error instanceof ApiError ? error.code : 'error.generic');
    } finally {
      this.busy.set(false);
    }
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
