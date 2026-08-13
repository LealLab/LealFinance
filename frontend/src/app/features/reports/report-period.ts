import { addMonthsClamped, formatIsoDate, monthKey } from '../../domain/calc/dates';

export type ReportPeriod = 'month' | '3m' | '6m' | '12m' | 'custom';

export interface MonthBucket {
  /** 'YYYY-MM' */
  key: string;
  /** Short display label, e.g. "ago/26". */
  label: string;
  start: Date;
  /** Last day of the month, inclusive. */
  end: Date;
}

const MONTH_FORMATTER = new Intl.DateTimeFormat('pt-BR', { month: 'short' });
const MAX_CUSTOM_BUCKETS = 36;

function toBucket(start: Date): MonthBucket {
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
  const label = `${MONTH_FORMATTER.format(start).replace('.', '')}/${String(start.getUTCFullYear()).slice(2)}`;
  return { key: monthKey(formatIsoDate(start)), label, start, end };
}

function currentMonthStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** The last `count` months, ending with the current month (inclusive). */
function trailingMonths(count: number): MonthBucket[] {
  const end = currentMonthStart();
  return Array.from({ length: count }, (_, i) => toBucket(addMonthsClamped(end, -(count - 1 - i))));
}

/**
 * Resolves a period selection into the month buckets it covers.
 * `custom` needs both bounds ('YYYY-MM' each); an incomplete or inverted
 * custom range falls back to the current month so the charts always have
 * at least one bucket to render.
 */
export function resolveMonthBuckets(
  period: ReportPeriod,
  customFrom?: string,
  customTo?: string
): MonthBucket[] {
  if (period === 'month') return trailingMonths(1);
  if (period === '3m') return trailingMonths(3);
  if (period === '6m') return trailingMonths(6);
  if (period === '12m') return trailingMonths(12);

  if (!customFrom || !customTo) return trailingMonths(1);
  const start = new Date(`${customFrom}-01T00:00:00Z`);
  const end = new Date(`${customTo}-01T00:00:00Z`);
  if (end.getTime() < start.getTime()) return trailingMonths(1);

  const buckets: MonthBucket[] = [];
  let cursor = start;
  while (cursor.getTime() <= end.getTime() && buckets.length < MAX_CUSTOM_BUCKETS) {
    buckets.push(toBucket(cursor));
    cursor = addMonthsClamped(cursor, 1);
  }
  return buckets;
}
