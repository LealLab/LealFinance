import { Component, effect, input, model, output, signal } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { Button } from '../button/button';
import { Modal } from '../modal/modal';

/**
 * t(settings.reauth.title, settings.reauth.description, profile.password.currentPassword)
 *
 * Asks for the account password again before a sensitive credential change
 * (adding or removing a passkey, starting two-factor enrollment). It only
 * collects the password: the caller sends it with its request, shows the
 * server's answer through `errorKey` (a wrong password stays here, the dialog
 * stays open), and closes the dialog on success.
 *
 * `titleKey` and `messageKey` are Transloco keys, so each caller can say what
 * the password is for; callers list their own keys in a t() comment.
 */
@Component({
  selector: 'app-password-confirm',
  imports: [TranslocoDirective, Button, Modal],
  templateUrl: './password-confirm.html',
  styleUrl: './password-confirm.scss',
})
export class PasswordConfirm {
  readonly open = model.required<boolean>();
  readonly titleKey = input('settings.reauth.title');
  readonly messageKey = input('settings.reauth.description');
  readonly busy = input(false);
  /** Full translation key of an error to show, e.g. `errors.auth.invalid_credentials`. */
  readonly errorKey = input<string | undefined>(undefined);
  readonly confirmed = output<string>();

  protected readonly password = signal('');

  constructor() {
    // Never keep a typed password around after the dialog closes.
    effect(() => {
      if (!this.open()) this.password.set('');
    });
  }

  protected submit(): void {
    const value = this.password();
    if (!value || this.busy()) return;
    this.confirmed.emit(value);
  }
}
