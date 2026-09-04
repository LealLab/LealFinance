import { Component, effect, ElementRef, input, model, viewChild } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { Button } from '../button/button';
import { Icon } from '../icon/icon';

/**
 * A modal built on native `<dialog>` + `showModal()` rather than a
 * hand-rolled overlay: focus trapping, Escape-to-close, backdrop, and
 * top-layer stacking all come from the platform, with no CDK dependency
 * and no focus-trap logic to get wrong.
 *
 * `open` is a two-way model - `[(open)]="isOpen"` - so both the caller
 * setting it false *and* the user pressing Escape (which the browser closes
 * the dialog for on its own) land in the same place: the `close` native
 * event is the single source of truth that flips the model back.
 *
 * Usage: `<app-modal [(open)]="isOpen" [titleText]="..." >...form...</app-modal>`,
 * with titleText bound to a Transloco-translated string from the caller
 * (not shown as a literal call here, so transloco-keys-manager doesn't
 * mistake this comment for a real usage site - see api-error.ts for the
 * same pattern).
 */
@Component({
  selector: 'app-modal',
  imports: [Icon, Button, TranslocoDirective],
  templateUrl: './modal.html',
})
export class Modal {
  readonly open = model.required<boolean>();
  readonly titleText = input.required<string>();

  // Not `.required()`: the constructor effect below can run its first pass
  // before the view's own child queries resolve, and a required query
  // throws (NG0951) rather than returning undefined in that window.
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('dialog');

  constructor() {
    effect(() => {
      const element = this.dialog()?.nativeElement;
      if (!element) return;
      if (this.open()) {
        if (!element.open) element.showModal();
      } else if (element.open) {
        element.close();
      }
    });
  }

  protected onNativeClose(): void {
    this.open.set(false);
  }

  protected onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.dialog()?.nativeElement.close();
    }
  }

  protected requestClose(): void {
    this.dialog()?.nativeElement.close();
  }
}
