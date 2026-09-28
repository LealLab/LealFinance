import {
  Component,
  computed,
  effect,
  ElementRef,
  HostListener,
  inject,
  input,
  model,
  signal,
  viewChild
} from '@angular/core';

/**
 * A trigger button plus a panel that opens below it - or above it when its
 * bottom edge would be hidden (end of the viewport, or a fixed bar such as
 * the phone bottom nav) and there is room above. Handles the plumbing
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
  host: { class: 'relative inline-block', '(click)': 'onHostClick($event)' },
})
export class Dropdown {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly open = model(false);
  /** Which edge of the trigger the panel aligns to. */
  readonly align = input<'start' | 'end'>('end');
  /** Width (and any extra) utility classes for the panel. */
  readonly panelClass = input('w-64');

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  /** True when the open panel flipped above the trigger. */
  protected readonly dropUp = signal(false);

  constructor() {
    effect(() => {
      const trigger = this.host.nativeElement.querySelector<HTMLElement>('[dropdownTrigger]');
      if (!trigger) return;
      trigger.setAttribute('aria-haspopup', 'true');
      trigger.setAttribute('aria-expanded', String(this.open()));
    });

    effect(() => {
      const panel = this.panel()?.nativeElement;
      if (!panel) {
        this.dropUp.set(false);
        return;
      }
      this.dropUp.set(this.bottomIsHidden(panel) && this.fitsAbove(panel));
    });
  }

  /** Whatever sits on the panel's bottom edge (a fixed bar, or nothing past
   * the viewport) tells whether that edge is actually visible. */
  private bottomIsHidden(panel: HTMLElement): boolean {
    if (typeof document.elementFromPoint !== 'function') return false;
    const rect = panel.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.bottom - 1);
    return !hit || !panel.contains(hit);
  }

  private fitsAbove(panel: HTMLElement): boolean {
    const trigger = this.host.nativeElement.getBoundingClientRect();
    // 8px = the mt-2/mb-2 gap between trigger and panel.
    return trigger.top - panel.offsetHeight - 8 >= 0;
  }

  protected readonly panelClasses = computed(
    () =>
      'absolute z-30 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-surface-raised p-1 shadow-lg ' +
      (this.dropUp() ? 'bottom-full mb-2 ' : 'mt-2 ') +
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
