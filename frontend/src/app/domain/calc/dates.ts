/**
 * Small ISO-date ('YYYY-MM-DD') helpers shared by the aggregation and
 * recurrence calculations. Everything here works in UTC - parsing a date
 * via `new Date(iso + 'T00:00:00Z')` and formatting back via
 * `toISOString().slice(0, 10)` - so a date never shifts by a day because
 * of the machine's local timezone.
 */

export function parseIsoDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Today's date in the machine's *local* calendar, as 'YYYY-MM-DD'.
 *
 * Use this - not `formatIsoDate(new Date())` - whenever the value means "the
 * user's today": form date defaults, the current-month bucket, "is this
 * cell today" markers. `formatIsoDate` is deliberately UTC, so at UTC-3 an
 * evening `new Date()` already rolls into tomorrow (and the next month).
 */
export function todayIso(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** The 'YYYY-MM' bucket a date falls in - matches Budget.month's format. */
export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

/**
 * First day of the *local* current month, as a UTC-anchored `Date` so it
 * composes with the UTC math in this module (`addMonthsClamped`, `Date.UTC`).
 * Picking the month from local getters keeps a late-evening UTC-3 user on
 * the month they actually see, not next month.
 */
export function monthStartUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/**
 * Adds calendar months to a date, clamping the day-of-month to whatever
 * the target month actually has - Jan 31 + 1 month lands on Feb 28 (or
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
