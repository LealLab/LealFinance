import { addMonthsClamped, formatIsoDate, monthKey, monthStartUtc } from '../../domain/calc/dates';

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

const MAX_CUSTOM_BUCKETS = 36;

function toBucket(start: Date, locale: string): MonthBucket {
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
  const month = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' })
    .format(start)
    .replace('.', '');
  const label = `${month}/${String(start.getUTCFullYear()).slice(2)}`;
  return { key: monthKey(formatIsoDate(start)), label, start, end };
}

/** The last `count` months, ending with the current month (inclusive). */
function trailingMonths(count: number, locale: string): MonthBucket[] {
  const end = monthStartUtc();
  return Array.from({ length: count }, (_, i) => toBucket(addMonthsClamped(end, -(count - 1 - i)), locale));
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
  customTo?: string,
  locale = 'en-US'
): MonthBucket[] {
  if (period === 'month') return trailingMonths(1, locale);
  if (period === '3m') return trailingMonths(3, locale);
  if (period === '6m') return trailingMonths(6, locale);
  if (period === '12m') return trailingMonths(12, locale);

  if (!customFrom || !customTo) return trailingMonths(1, locale);
  const start = new Date(`${customFrom}-01T00:00:00Z`);
  const end = new Date(`${customTo}-01T00:00:00Z`);
  if (end.getTime() < start.getTime()) return trailingMonths(1, locale);

  const buckets: MonthBucket[] = [];
  let cursor = start;
  while (cursor.getTime() <= end.getTime() && buckets.length < MAX_CUSTOM_BUCKETS) {
    buckets.push(toBucket(cursor, locale));
    cursor = addMonthsClamped(cursor, 1);
  }
  return buckets;
}
