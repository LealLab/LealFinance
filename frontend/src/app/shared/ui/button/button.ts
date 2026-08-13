import { Component, computed, input } from '@angular/core';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

const BASE =
  'inline-flex items-center justify-center gap-1.5 rounded font-medium ' +
  'transition-colors disabled:cursor-not-allowed disabled:opacity-50';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-content hover:brightness-110',
  secondary:
    'border border-border bg-surface-raised text-content-primary hover:bg-surface-sunken',
  ghost: 'text-content-primary hover:bg-surface-sunken',
  danger: 'bg-negative text-white hover:brightness-110'
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'px-2.5 py-1 text-sm',
  md: 'px-3.5 py-2 text-sm'
};

/**
 * Attaches to a native `<button>` (selector `button[appButton]`) rather than
 * wrapping one — that keeps `type`, `disabled`, and `form` as real button
 * attributes the caller sets directly, so this primitive doesn't have to
 * re-declare and forward them.
 *
 * Usage: `<button appButton variant="primary">` with a Transloco-translated
 * label as content (not shown as a literal call here — see api-error.ts).
 */
@Component({
  selector: 'button[appButton]',
  templateUrl: './button.html',
  styleUrl: './button.scss',
  host: {
    '[class]': 'classes()'
  }
})
export class Button {
  readonly variant = input<ButtonVariant>('primary');
  readonly size = input<ButtonSize>('md');

  protected readonly classes = computed(
    () => `${BASE} ${VARIANT_CLASSES[this.variant()]} ${SIZE_CLASSES[this.size()]}`
  );
}
