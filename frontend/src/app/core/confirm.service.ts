import { Injectable, signal } from '@angular/core';

/**
 * Shaped like Transloco's own `HashMap<T>` (`Record<string, T>`), but that
 * type isn't part of `@jsverse/transloco`'s public entry point (its
 * `exports` map only exposes `.` and `./package.json`), so it's redeclared
 * here rather than deep-imported.
 */
export type ConfirmParams = Record<string, unknown>;

export interface ConfirmRequest {
  titleKey: string;
  messageKey: string;
  tone: 'default' | 'danger';
  /** Interpolation values for `messageKey`, e.g. `{{count}}` placeholders — see t() usage in confirm-dialog.html. */
  params?: ConfirmParams;
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

  confirm(
    titleKey: string,
    messageKey: string,
    tone: 'default' | 'danger' = 'default',
    params?: ConfirmParams
  ): Promise<boolean> {
    return new Promise((resolve) => {
      this.pending.set({ titleKey, messageKey, tone, params, resolve });
    });
  }

  respond(confirmed: boolean): void {
    this.pending()?.resolve(confirmed);
    this.pending.set(null);
  }
}
