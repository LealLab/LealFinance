import { Component, computed, input } from '@angular/core';

export type ProgressTone = 'accent' | 'warning' | 'negative';

const FILL_CLASSES: Record<ProgressTone, string> = {
  accent: 'bg-accent',
  warning: 'bg-warning',
  negative: 'bg-negative'
};

/**
 * A budget/limit progress bar. `ratio` is spent÷budgeted and can exceed 1 —
 * the fill visually clamps at 100% but the color escalates
 * accent → warning → negative so an over-budget category is unmistakable
 * even before reading the numbers next to it.
 */
@Component({
  selector: 'app-progress-bar',
  templateUrl: './progress-bar.html',
  styleUrl: './progress-bar.scss'
})
export class ProgressBar {
  readonly ratio = input.required<number>();
  readonly label = input<string>();

  protected readonly percentClamped = computed(() =>
    Math.min(100, Math.max(0, this.ratio() * 100))
  );

  protected readonly tone = computed<ProgressTone>(() => {
    const ratio = this.ratio();
    if (ratio > 1) return 'negative';
    if (ratio >= 0.8) return 'warning';
    return 'accent';
  });

  protected readonly fillClass = computed(() => FILL_CLASSES[this.tone()]);
}
