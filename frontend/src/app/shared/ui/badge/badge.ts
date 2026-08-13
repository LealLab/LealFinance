import { Component, input } from '@angular/core';

export type BadgeTone = 'neutral' | 'positive' | 'negative' | 'warning' | 'accent';

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-sunken text-content-muted',
  positive: 'bg-positive/10 text-positive',
  negative: 'bg-negative/10 text-negative',
  warning: 'bg-warning/10 text-warning',
  accent: 'bg-accent/10 text-accent'
};

/** Small pill for status/kind labels — transaction type, budget state, etc. */
@Component({
  selector: 'app-badge',
  templateUrl: './badge.html',
  styleUrl: './badge.scss',
  host: {
    '[class]': 'classes()'
  }
})
export class Badge {
  readonly tone = input<BadgeTone>('neutral');

  protected readonly classes = () =>
    `inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${TONE_CLASSES[this.tone()]}`;
}
