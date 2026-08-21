import { Component, input } from '@angular/core';

/**
 * A pulsing placeholder block, shown in place of a figure/chart/list row
 * while its data isn't ready to compute yet - e.g. the dashboard's money
 * cards while `displayConverter`'s converter is still `null` (see
 * shared/money/display-converter.ts). `height` takes any CSS size
 * (`'1rem'`, `'16rem'`); width always fills the container.
 */
@Component({
  selector: 'app-skeleton',
  templateUrl: './skeleton.html',
  styleUrl: './skeleton.scss',
  host: {
    class: 'block animate-pulse rounded-md bg-surface-sunken',
    '[style.height]': 'height()',
    'aria-hidden': 'true'
  }
})
export class Skeleton {
  readonly height = input('1rem');
}
