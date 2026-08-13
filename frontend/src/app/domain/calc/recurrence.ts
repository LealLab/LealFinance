import { ProjectedTransaction, RecurringFrequency, RecurringRule } from '../models/recurring';
import { addDays, addMonthsClamped, formatIsoDate, parseIsoDate } from './dates';

/**
 * The date of the Nth occurrence (`periods` = rule.interval × N), computed
 * directly from the rule's start date every time rather than by stepping
 * from the previous occurrence. That matters for month-end anchors: a
 * monthly rule starting Jan 31 must land on Mar 31 (not Mar 28) even
 * though the Feb occurrence in between clamped to 28 — stepping from a
 * clamped date would permanently lose the day-31 anchor, recomputing from
 * `start` every time doesn't.
 */
function occurrenceDate(start: Date, frequency: RecurringFrequency, periods: number): Date {
  switch (frequency) {
    case 'weekly':
      return addDays(start, 7 * periods);
    case 'monthly':
      return addMonthsClamped(start, periods);
    case 'yearly':
      return addMonthsClamped(start, 12 * periods);
  }
}

// A pathological rule (interval 0 or a huge range) shouldn't be able to
// spin this loop forever.
const MAX_OCCURRENCES = 2000;

/**
 * Expands a RecurringRule into its projected occurrences within
 * [rangeStart, rangeEnd] (inclusive, ISO dates). These are projections
 * only — see RecurringRule's doc comment — never persisted, and callers
 * must keep them out of balance/total/budget calculations.
 */
export function projectOccurrences(
  rule: RecurringRule,
  rangeStart: string,
  rangeEnd: string
): ProjectedTransaction[] {
  if (rule.interval < 1) return [];

  const start = parseIsoDate(rule.startDate);
  const rangeStartTime = parseIsoDate(rangeStart).getTime();
  const rangeEndTime = parseIsoDate(rangeEnd).getTime();
  const ruleEndTime = rule.endDate ? parseIsoDate(rule.endDate).getTime() : undefined;

  const occurrences: ProjectedTransaction[] = [];

  for (let index = 0; index < MAX_OCCURRENCES; index++) {
    const date = occurrenceDate(start, rule.frequency, rule.interval * index);
    const time = date.getTime();

    if (time > rangeEndTime) break;
    if (ruleEndTime !== undefined && time > ruleEndTime) break;

    if (time >= rangeStartTime) {
      occurrences.push({
        ...rule.template,
        date: formatIsoDate(date),
        recurringRuleId: rule.id,
        isProjected: true
      });
    }
  }

  return occurrences;
}
