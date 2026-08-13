import { Component, input } from '@angular/core';

/**
 * The base surface for grouped content across the app. Deliberately plain —
 * a 1px border and a raised background, no shadow — per the "borders and
 * spacing carry hierarchy, not shadows" design direction.
 */
@Component({
  selector: 'app-card',
  templateUrl: './card.html',
  styleUrl: './card.scss',
  host: {
    class: 'block rounded-md border border-border bg-surface-raised',
    '[class.p-4]': 'padded()'
  }
})
export class Card {
  readonly padded = input(true);
}
