import { Component, input } from '@angular/core';

export type StatTone = 'default' | 'positive' | 'negative';

const TONE_CLASSES: Record<StatTone, string> = {
  default: 'text-content-primary',
  positive: 'text-positive',
  negative: 'text-negative'
};

/**
 * A single labeled figure - the dashboard's stat row and account/budget
 * summaries are built from these. The value renders in the monospace
 * "ledger" face (see tailwind.css --font-mono) since it's always a
 * pre-formatted amount or count, never prose.
 *
 * An element marked `statTileAction` is projected next to the label (e.g. a
 * help popover); the tile is `relative` so a static popover panel can anchor
 * to the whole tile instead of the small trigger.
 */
@Component({
  selector: 'app-stat-tile',
  templateUrl: './stat-tile.html',
})
export class StatTile {
  readonly label = input.required<string>();
  readonly value = input.required<string>();
  readonly hint = input<string>();
  readonly tone = input<StatTone>('default');
  /** Larger figure for the one number a screen is about; steps back down on wide screens. */
  readonly prominent = input(false);

  protected readonly toneClass = TONE_CLASSES;
}
