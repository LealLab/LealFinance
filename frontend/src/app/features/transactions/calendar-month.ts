import { CurrencyConverter } from '../../domain/calc/aggregations';
import { addDays, formatIsoDate, parseIsoDate } from '../../domain/calc/dates';
import { effectiveAmount, sourceAmount } from '../../domain/calc/conversion';
import { ProjectedTransaction } from '../../domain/models/recurring';
import { Transaction } from '../../domain/models/transaction';
import { add, Money, subtract, zero } from '../../shared/money/money';

export interface CalendarDay {
  date: string;
  dayOfMonth: number;
  /** false for leading/trailing days from adjacent months. */
  inMonth: boolean;
  isToday: boolean;
  hasIncome: boolean;
  hasExpense: boolean;
  hasTransfer: boolean;
  hasProjected: boolean;
  /** Portfolio balance at end of day, in the target currency. null outside
   * the month, or when the opening balance isn't available yet. */
  balance: string | null;
  transactions: Transaction[];
}

/**
 * Portfolio-wide signed delta of one transaction, in `target`. Mirrors
 * app/services/accounts.py::account_balances summed across every owned
 * account: income/interest credit the effective amount, expense debits it,
 * and a transfer debits the source leg (origin amount) while crediting the
 * destination leg (effective amount) - so a same-currency transfer nets to
 * zero and a cross-currency one nets to the fee/spread.
 */
export function portfolioDelta(
  tx: Transaction,
  convert: CurrencyConverter,
  target: string,
): Money {
  if (tx.type === 'income' || tx.type === 'interest') {
    return convert(effectiveAmount(tx), target);
  }
  if (tx.type === 'expense') {
    return subtract(zero(target), convert(effectiveAmount(tx), target));
  }
  // transfer: out on the source leg, in on the destination leg.
  return subtract(convert(effectiveAmount(tx), target), convert(sourceAmount(tx), target));
}

/**
 * Always 6 rows x 7 columns = 42 cells, so the grid height never jumps
 * between months. `weekStart` is a 0-6 weekday index (1 = Monday).
 * `opening` is the portfolio balance the day before the month starts, in
 * the currency the running balances accumulate in; null suppresses them.
 */
export function buildMonthGrid(
  month: string,
  transactions: readonly Transaction[],
  projected: readonly ProjectedTransaction[],
  opening: Money | null,
  convert: CurrencyConverter,
  weekStart: number,
  today: string,
): CalendarDay[] {
  const first = parseIsoDate(`${month}-01`);
  const lead = (first.getUTCDay() - weekStart + 7) % 7;
  const gridStart = addDays(first, -lead);

  const byDate = new Map<string, Transaction[]>();
  for (const tx of transactions) {
    const list = byDate.get(tx.date);
    if (list) list.push(tx);
    else byDate.set(tx.date, [tx]);
  }
  const projectedDates = new Set(projected.map((p) => p.date));

  const target = opening?.currency ?? '';
  let running = opening;
  const days: CalendarDay[] = [];

  for (let i = 0; i < 42; i++) {
    const date = formatIsoDate(addDays(gridStart, i));
    const inMonth = date.slice(0, 7) === month;
    const dayTransactions = byDate.get(date) ?? [];

    if (inMonth && running) {
      running = dayTransactions.reduce(
        (total, tx) => add(total, portfolioDelta(tx, convert, target)),
        running,
      );
    }

    days.push({
      date,
      dayOfMonth: Number(date.slice(8, 10)),
      inMonth,
      isToday: date === today,
      hasIncome: dayTransactions.some((tx) => tx.type === 'income' || tx.type === 'interest'),
      hasExpense: dayTransactions.some((tx) => tx.type === 'expense'),
      hasTransfer: dayTransactions.some((tx) => tx.type === 'transfer'),
      hasProjected: inMonth && projectedDates.has(date),
      balance: inMonth && running ? running.amount : null,
      transactions: dayTransactions,
    });
  }

  return days;
}
