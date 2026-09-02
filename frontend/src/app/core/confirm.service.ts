import { Injectable, signal } from '@angular/core';

/**
 * Shaped like Transloco's own `HashMap<T>` (`Record<string, T>`), but that
 * type isn't part of `@jsverse/transloco`'s public entry point (its
 * `exports` map only exposes `.` and `./package.json`), so it's redeclared
 * here rather than deep-imported.
 */
export type ConfirmParams = Record<string, unknown>;

export interface ConfirmChoice {
  labelKey: string;
  value: string;
  tone?: 'default' | 'danger';
}

export interface ConfirmRequest {
  titleKey: string;
  messageKey: string;
  tone: 'default' | 'danger';
  /** Interpolation values for `messageKey`, e.g. `{{count}}` placeholders - see t() usage in confirm-dialog.html. */
  params?: ConfirmParams;
  choices?: ConfirmChoice[];
}

interface PendingConfirm extends ConfirmRequest {
  resolve: (value: boolean | string | null) => void;
}

/**
 * App-wide "are you sure?" confirmation, backed by a single
 * <app-confirm-dialog> mounted once in the shell (see layout/shell.html)
 * rather than one per delete button - every destructive action across
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
    params?: ConfirmParams,
  ): Promise<boolean> {
    return this.ask({ titleKey, messageKey, tone, params });
  }

  choose(
    titleKey: string,
    messageKey: string,
    choices: ConfirmChoice[],
    params?: ConfirmParams,
  ): Promise<string | null> {
    return this.ask({ titleKey, messageKey, tone: 'default', choices, params });
  }

  private ask<T>(request: ConfirmRequest): Promise<T> {
    return new Promise<T>((resolve) => {
      this.pending.set({
        ...request,
        resolve: resolve as (value: boolean | string | null) => void,
      });
    });
  }

  respond(confirmed: boolean): void {
    this.complete(confirmed);
  }

  respondChoice(value: string | null): void {
    this.complete(value);
  }

  dismiss(): void {
    const pending = this.pending();
    if (pending) this.complete(pending.choices ? null : false);
  }

  private complete(value: boolean | string | null): void {
    this.pending()?.resolve(value);
    this.pending.set(null);
  }
}
