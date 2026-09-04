import { Component, computed, inject, input, model } from '@angular/core';
import { TranslocoLocaleService } from '@jsverse/transloco-locale';
import {
  addMonthsClamped,
  formatIsoDate,
  monthKey,
  parseIsoDate,
} from '../../../domain/calc/dates';
import { Button } from '../button/button';
import { Icon } from '../icon/icon';

/** Switches between adjacent calendar months. */
@Component({
  selector: 'app-month-switcher',
  imports: [Button, Icon],
  templateUrl: './month-switcher.html',
})
export class MonthSwitcher {
  private readonly locale = inject(TranslocoLocaleService);

  readonly month = model.required<string>();
  readonly prevLabel = input<string>('');
  readonly nextLabel = input<string>('');

  protected readonly label = computed(() =>
    this.locale.localizeDate(`${this.month()}-01`, undefined, {
      year: 'numeric',
      month: 'long',
    }),
  );

  protected stepMonth(delta: number): void {
    this.month.set(
      monthKey(formatIsoDate(addMonthsClamped(parseIsoDate(`${this.month()}-01`), delta))),
    );
  }
}
