export type TransactionType = 'income' | 'expense' | 'transfer' | 'interest';

/** Where a transaction's `conversion` rate came from. */
export type ConversionSource = 'manual' | 'quote' | 'fallback';

/**
 * Records what actually happened when a transaction's `amount`/`currency`
 * (the ORIGIN side) differ from the currency of the account it's affecting
 * (the DESTINATION side) - see domain/calc/conversion.ts for the read-side
 * helpers built on this, and docs/money-and-currency.md for the full rule.
 *
 * `amount`/`currency` here are always the DESTINATION side - what actually
 * posted to the account whose currency differs from `Transaction.currency`:
 * - transfer: `Transaction.currency` is the source account's; `conversion`
 *   is the destination account's.
 * - income/expense/interest: `Transaction.currency` is the currency the
 *   money was denominated in; `conversion` is the account's own currency.
 *
 * `fee` is in the ORIGIN currency (`Transaction.currency`), deducted
 * *before* conversion: `conversion.amount = (Transaction.amount - fee) *
 * conversion.rate`. The origin account is still debited the full
 * `Transaction.amount` - the fee is what didn't make it across, not an
 * extra charge on top.
 */
export interface TransactionConversion {
  amount: string;
  currency: string;
  fee?: string;
  rate: string;
  source: ConversionSource;
}

/**
 * A single ledger entry. `amount` is always positive - `type` carries the
 * direction, so there's exactly one way to represent "spent 50", never a
 * choice between a positive expense and a negative one.
 *
 * Transfers move money between two of the user's own accounts and are
 * *not* income or expense - every aggregation in domain/calc/ must
 * exclude them, or totals double-count money that never left the
 * household. Interest is a positive account entry used by savings goals;
 * it also never counts as household income. `toAccountId` is set only for
 * transfers; `categoryId` is absent for transfers and interest entries.
 *
 * `conversion` is present iff this transaction is cross-currency (its own
 * `currency` differs from the currency of the account it affects) - see
 * `TransactionConversion` above. Every read of "how much moved" must go
 * through domain/calc/conversion.ts rather than `amount`/`currency`
 * directly, or it'll see the origin side instead of what actually landed.
 *
 * `recurringRuleId` is set when this occurrence was generated from a
 * RecurringRule - see domain/calc/recurrence.ts. A *projected* future
 * occurrence (not yet an actual transaction) is a plain object shaped like
 * this one but never stored; see RecurringRule for that distinction.
 *
 * `loanId` is set when this expense is a loan installment payment (see
 * domain/models/loan.ts). The count of transactions carrying a given
 * `loanId` is how many installments of that loan have been paid.
 *
 * `cardInvoiceCloseDate` is set on the transfer that pays a credit-card
 * invoice - it's the close date of the billing cycle the payment settles
 * (see domain/models/card-invoice.ts). Read-only here: payments are made
 * through the pay-invoice endpoint, not by setting this directly.
 *
 * `installmentGroupId` / `installmentNumber` / `installmentCount` are set
 * on each row of a credit-card purchase split into equal monthly
 * installments ("3/10"). They are written by the backend when a create
 * request carries an `installments` count; all three are present or none.
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
  loanId?: string;
  cardInvoiceCloseDate?: string;
  installmentGroupId?: string;
  installmentNumber?: number;
  installmentCount?: number;
  conversion?: TransactionConversion;
}

/**
 * Extra field on a create request: split a credit-card expense into N
 * equal monthly installments. Not part of the stored Transaction.
 */
export interface TransactionInstallmentOptions {
  installments?: number;
}
