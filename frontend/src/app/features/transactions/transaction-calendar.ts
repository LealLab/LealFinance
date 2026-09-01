import { Component, computed, inject, input, output } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { TranslocoLocaleService } from '@jsverse/transloco-locale';
import { Account } from '../../domain/models/account';
import { Category } from '../../domain/models/category';
import { Institution } from '../../domain/models/institution';
import { CurrencyConverter } from '../../domain/calc/aggregations';
import { addDays, parseIsoDate } from '../../domain/calc/dates';
import { Transaction } from '../../domain/models/transaction';
import { add, toNumber, zero } from '../../shared/money/money';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { Icon } from '../../shared/ui/icon/icon';
import { CalendarDay, portfolioDelta } from './calendar-month';
import { rowSign, rowToneClass } from './transaction-tone';

/**
 * Month grid of running daily balances plus a selected-day panel. The grid
 * itself is built by the parent (buildMonthGrid) so this component stays
 * presentational.
 */
@Component({
  selector: 'app-transaction-calendar',
  imports: [TranslocoDirective, MoneyPipe, Icon],
  templateUrl: './transaction-calendar.html',
  styleUrl: './transaction-calendar.scss',
})
export class TransactionCalendar {
  private readonly locale = inject(TranslocoLocaleService);

  readonly days = input.required<readonly CalendarDay[]>();
  readonly selectedDay = input<string | null>(null);
  readonly displayCurrency = input.required<string>();
  /** Same portfolio converter the grid's running balances use; null until
   * every rate has arrived, which suppresses the day-net line. */
  readonly converter = input<CurrencyConverter | null>(null);
  readonly accountsById = input.required<ReadonlyMap<string, Account>>();
  readonly institutionsById = input<ReadonlyMap<string, Institution>>(new Map());
  readonly categoriesById = input.required<ReadonlyMap<string, Category>>();
  readonly weekStart = input(1);

  readonly daySelected = output<string>();
  readonly edit = output<Transaction>();

  protected readonly rowToneClass = rowToneClass;
  protected readonly rowSign = rowSign;

  protected readonly weekdayLabels = computed(() => {
    // 2024-01-07 is a Sunday (getUTCDay() === 0); offset to each weekday.
    const sunday = parseIsoDate('2024-01-07');
    return Array.from({ length: 7 }, (_, i) =>
      this.locale.localizeDate(addDays(sunday, (this.weekStart() + i) % 7), undefined, {
        weekday: 'short',
      }),
    );
  });

  protected readonly selected = computed(() =>
    this.days().find((day) => day.date === this.selectedDay()),
  );

  protected readonly selectedDayLabel = computed(() => {
    const day = this.selected();
    return day
      ? this.locale.localizeDate(day.date, undefined, {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      : '';
  });

  protected readonly dayNet = computed<number | null>(() => {
    const day = this.selected();
    const convert = this.converter();
    if (!day || !convert) return null;
    // Same per-transaction delta the grid's running balance uses, so the
    // panel and the cell above it agree - every leg converted into the
    // display currency, transfers netting to ~0.
    const target = this.displayCurrency();
    const total = day.transactions.reduce(
      (acc, tx) => add(acc, portfolioDelta(tx, convert, target)),
      zero(target),
    );
    return toNumber(total);
  });

  protected readonly absNet = computed(() => Math.abs(this.dayNet() ?? 0).toFixed(2));

  /** Polyline points across the month's end-of-day balances, 0-100 x, 0-24 y. */
  protected readonly sparklinePoints = computed(() => {
    const values = this.days()
      .filter((day) => day.inMonth && day.balance !== null)
      .map((day) => Number(day.balance));
    if (values.length < 2) return '';
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    return values
      .map((value, index) => {
        const x = (index / (values.length - 1)) * 100;
        const y = 24 - ((value - min) / span) * 24;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');
  });

  protected accountName(id: string | undefined): string {
    return id ? (this.accountsById().get(id)?.name ?? '') : '';
  }

  protected institutionName(id: string | undefined): string {
    const institutionId = id ? this.accountsById().get(id)?.institutionId : undefined;
    return institutionId ? (this.institutionsById().get(institutionId)?.name ?? '') : '';
  }

  /** account · institution · category - dropping the parts that are empty
   * (a cash account, an interest row with no category) so the separators
   * never dangle. */
  protected subtitle(tx: Transaction): string {
    return [this.accountName(tx.accountId), this.institutionName(tx.accountId), this.categoryName(tx)]
      .filter(Boolean)
      .join(' · ');
  }

  protected categoryName(tx: Transaction): string {
    if (tx.type === 'transfer') return this.accountName(tx.toAccountId);
    return tx.categoryId ? (this.categoriesById().get(tx.categoryId)?.name ?? '') : '';
  }

  protected categoryColor(tx: Transaction): string | null {
    if (tx.type === 'transfer') return null;
    return tx.categoryId ? (this.categoriesById().get(tx.categoryId)?.color ?? null) : null;
  }
}
