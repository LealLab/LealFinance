import { Transaction } from './transaction';

export type RecurringFrequency = 'weekly' | 'monthly' | 'yearly';

/**
 * A rule that describes a repeating transaction. A backend Celery beat task
 * posts each due occurrence as a real Transaction (see
 * backend/app/services/recurring_posting.py), advancing `lastPostedDate` as
 * it goes - that's the authoritative history. This app also still projects
 * *upcoming* occurrences on demand for display
 * (domain/calc/recurrence.ts::projectOccurrences); those projections are
 * visually distinct in the UI and are never counted in balances, totals, or
 * budget spend - only what actually posted is.
 */
export interface RecurringRule {
  id: string;
  frequency: RecurringFrequency;
  /** Repeat every N periods - 1 = every period, 2 = every other, etc. */
  interval: number;
  startDate: string;
  endDate?: string;
  /** The last occurrence date actually posted by the backend, if any. */
  lastPostedDate?: string;
  template: Omit<Transaction, 'id' | 'date' | 'recurringRuleId'>;
}

/**
 * One projected occurrence of a RecurringRule, shaped like a Transaction so
 * it can render in the same list - but never assigned an id or persisted.
 */
export interface ProjectedTransaction
  extends Omit<Transaction, 'id' | 'recurringRuleId'> {
  recurringRuleId: string;
  isProjected: true;
}
