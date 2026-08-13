import { Injectable, signal } from '@angular/core';

export interface ConfirmRequest {
  titleKey: string;
  messageKey: string;
  tone: 'default' | 'danger';
}

interface PendingConfirm extends ConfirmRequest {
  resolve: (confirmed: boolean) => void;
}

/**
 * App-wide "are you sure?" confirmation, backed by a single
 * <app-confirm-dialog> mounted once in the shell (see layout/shell.html)
 * rather than one per delete button — every destructive action across
 * Transactions/Categories/Budgets/Accounts calls `confirm()` and awaits
 * the answer instead of each screen owning its own dialog markup.
 */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  private readonly pending = signal<PendingConfirm | null>(null);

  readonly request = this.pending.asReadonly();

  confirm(titleKey: string, messageKey: string, tone: 'default' | 'danger' = 'default'): Promise<boolean> {
    return new Promise((resolve) => {
      this.pending.set({ titleKey, messageKey, tone, resolve });
    });
  }

  respond(confirmed: boolean): void {
    this.pending()?.resolve(confirmed);
    this.pending.set(null);
  }
}
