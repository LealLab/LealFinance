import { Transaction } from './transaction';

export type RecurringFrequency = 'weekly' | 'monthly' | 'yearly';

/**
 * A rule that *projects* future transactions rather than storing them — a
 * monthly rent entry is one RecurringRule, not twelve pre-created
 * Transaction rows. domain/calc/recurrence.ts expands a rule into
 * occurrences on demand; those projections are visually distinct in the UI
 * and never counted in balances, totals, or budget spend until (in a real
 * system) they're actually posted. This scaffold has no posting step, so
 * every occurrence a rule produces stays a projection.
 */
export interface RecurringRule {
  id: string;
  frequency: RecurringFrequency;
  /** Repeat every N periods — 1 = every period, 2 = every other, etc. */
  interval: number;
  startDate: string;
  endDate?: string;
  template: Omit<Transaction, 'id' | 'date' | 'recurringRuleId'>;
}

/**
 * One projected occurrence of a RecurringRule, shaped like a Transaction so
 * it can render in the same list — but never assigned an id or persisted.
 */
export interface ProjectedTransaction
  extends Omit<Transaction, 'id' | 'recurringRuleId'> {
  recurringRuleId: string;
  isProjected: true;
}
