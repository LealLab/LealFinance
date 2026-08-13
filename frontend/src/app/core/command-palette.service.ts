import { Injectable, signal } from '@angular/core';

/**
 * Open/closed state for the global Ctrl+K / Cmd+K command palette
 * (layout/command-palette/command-palette.ts), mounted once in
 * layout/shell.html next to <app-confirm-dialog /> — same singleton,
 * signal-backed-state-in-a-service pattern as ConfirmService
 * (core/confirm.service.ts), just without a request payload: there's only
 * one palette, so "open" is enough state to carry.
 *
 * Named `isOpen`/`show`/`hide`/`toggle` (not `open`/`open()`) so the
 * readonly signal and the mutator methods don't collide on the same
 * identifier.
 */
@Injectable({ providedIn: 'root' })
export class CommandPaletteService {
  private readonly openState = signal(false);

  readonly isOpen = this.openState.asReadonly();

  show(): void {
    this.openState.set(true);
  }

  hide(): void {
    this.openState.set(false);
  }

  toggle(): void {
    this.openState.update((open) => !open);
  }
}
