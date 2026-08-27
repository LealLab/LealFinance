import { Component, computed, ElementRef, HostListener, inject, input, model } from '@angular/core';

/**
 * A trigger button plus a panel that opens below it. Handles the plumbing
 * every menu needs: click-outside to dismiss, Escape to dismiss, and focus
 * returning to the trigger on close.
 *
 * Project the trigger with `[dropdownTrigger]` and the panel content as the
 * default slot:
 *
 * ```html
 * <app-dropdown [(open)]="menuOpen" panelClass="w-72">
 *   <button dropdownTrigger appButton variant="secondary">Filters</button>
 *   <div class="p-2">…panel…</div>
 * </app-dropdown>
 * ```
 *
 * ponytail: plain relative/absolute positioning + two host listeners. The
 * native `popover` attribute would give light-dismiss, Escape and top-layer
 * for free, but CSS anchor positioning (to place the panel under the
 * trigger) is Chrome-only today - switch when it lands cross-browser.
 */
@Component({
  selector: 'app-dropdown',
  templateUrl: './dropdown.html',
  styleUrl: './dropdown.scss',
  host: { class: 'relative inline-block', '(click)': 'onHostClick($event)' },
})
export class Dropdown {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly open = model(false);
  /** Which edge of the trigger the panel aligns to. */
  readonly align = input<'start' | 'end'>('end');
  /** Width (and any extra) utility classes for the panel. */
  readonly panelClass = input('w-64');

  protected readonly panelClasses = computed(
    () =>
      'absolute z-30 mt-2 rounded-lg border border-border bg-surface-raised p-1 shadow-lg ' +
      (this.align() === 'start' ? 'left-0 ' : 'right-0 ') +
      this.panelClass(),
  );

  /** A click anywhere on the projected trigger opens/closes the panel. */
  protected onHostClick(event: MouseEvent): void {
    const trigger = this.host.nativeElement.querySelector('[dropdownTrigger]');
    if (trigger?.contains(event.target as Node)) this.open.update((value) => !value);
  }

  protected close(): void {
    if (!this.open()) return;
    this.open.set(false);
    this.host.nativeElement.querySelector<HTMLElement>('[dropdownTrigger]')?.focus();
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent): void {
    if (!this.open()) return;
    if (!this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.close();
  }
}
