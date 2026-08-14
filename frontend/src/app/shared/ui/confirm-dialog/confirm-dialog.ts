import { Component, computed, inject } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { ConfirmService } from '../../../core/confirm.service';
import { Button, ButtonVariant } from '../button/button';
import { Modal } from '../modal/modal';

/**
 * Renders the currently pending ConfirmService request, if any. Mounted
 * once in layout/shell.html so every destructive action anywhere in the
 * app shares one dialog instead of each screen wiring its own.
 */
@Component({
  selector: 'app-confirm-dialog',
  imports: [TranslocoDirective, Modal, Button],
  templateUrl: './confirm-dialog.html',
  styleUrl: './confirm-dialog.scss'
})
export class ConfirmDialog {
  protected readonly confirmService = inject(ConfirmService);

  protected readonly open = computed(() => this.confirmService.request() !== null);
  protected readonly confirmVariant = computed<ButtonVariant>(() =>
    this.confirmService.request()?.tone === 'danger' ? 'danger' : 'primary'
  );

  protected respond(confirmed: boolean): void {
    this.confirmService.respond(confirmed);
  }

  protected onOpenChange(open: boolean): void {
    // The modal can close itself (Escape, backdrop click) without going
    // through respond() - treat that the same as cancelling.
    if (!open) this.confirmService.respond(false);
  }
}
