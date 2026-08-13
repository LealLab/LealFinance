export type TransactionType = 'income' | 'expense' | 'transfer';

/**
 * A single ledger entry. `amount` is always positive — `type` carries the
 * direction, so there's exactly one way to represent "spent 50", never a
 * choice between a positive expense and a negative one.
 *
 * Transfers move money between two of the user's own accounts and are
 * *not* income or expense — every aggregation in domain/calc/ must
 * exclude them, or totals double-count money that never left the
 * household. `toAccountId` is set only for transfers; `categoryId` is
 * absent for them (a transfer isn't spending, so it doesn't have a
 * spending category).
 *
 * `recurringRuleId` is set when this occurrence was generated from a
 * RecurringRule — see domain/calc/recurrence.ts. A *projected* future
 * occurrence (not yet an actual transaction) is a plain object shaped like
 * this one but never stored; see RecurringRule for that distinction.
 */
export interface Transaction {
  id: string;
  type: TransactionType;
  date: string;
  amount: string;
  currency: string;
  accountId: string;
  toAccountId?: string;
  categoryId?: string;
  description: string;
  notes?: string;
  recurringRuleId?: string;
}
