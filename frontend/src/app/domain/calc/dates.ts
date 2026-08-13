/**
 * Small ISO-date ('YYYY-MM-DD') helpers shared by the aggregation and
 * recurrence calculations. Everything here works in UTC — parsing a date
 * via `new Date(iso + 'T00:00:00Z')` and formatting back via
 * `toISOString().slice(0, 10)` — so a date never shifts by a day because
 * of the machine's local timezone.
 */

export function parseIsoDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The 'YYYY-MM' bucket a date falls in — matches Budget.month's format. */
export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/**
 * Adds calendar months to a date, clamping the day-of-month to whatever
 * the target month actually has — Jan 31 + 1 month lands on Feb 28 (or
 * 29), not an overflowed Mar 3. `months` may be negative.
 */
export function addMonthsClamped(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  const targetIndex = month + months;
  const targetYear = year + Math.floor(targetIndex / 12);
  const targetMonth = ((targetIndex % 12) + 12) % 12;
  const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();

  return new Date(Date.UTC(targetYear, targetMonth, Math.min(day, lastDayOfTargetMonth)));
}
