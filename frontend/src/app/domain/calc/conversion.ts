import { money, Money } from '../../shared/money/money';
import { Transaction } from '../models/transaction';

/**
 * The single place that knows how a Transaction's `conversion` reads back -
 * every downstream calculation (balances, aggregations, budgets) must go
 * through these rather than reading `amount`/`currency` directly, or it'll
 * see the origin side of a cross-currency transaction instead of what
 * actually landed. See domain/models/transaction.ts for the shape.
 */

/**
 * What actually moved, in the currency of the account it moved into/out of:
 * the conversion's amount/currency when this is a cross-currency
 * transaction, otherwise the plain amount/currency.
 */
export function effectiveAmount(tx: Transaction): Money {
  if (tx.conversion) {
    return money(tx.conversion.amount, tx.conversion.currency);
  }
  return money(tx.amount, tx.currency);
}

/** The origin-side amount/currency, ignoring any conversion. */
export function sourceAmount(tx: Transaction): Money {
  return money(tx.amount, tx.currency);
}

/**
 * The tax/spread paid to convert, in the origin currency - `null` when
 * there's no conversion or no fee was recorded. Feeds the "how much did I
 * lose to conversion fees" metric on the Exchange page.
 */
export function conversionFee(tx: Transaction): Money | null {
  if (!tx.conversion?.fee) {
    return null;
  }
  return money(tx.conversion.fee, tx.currency);
}

/**
 * True when this transaction's conversion used a 1:1 fallback rate rather
 * than a manual rate or a live quote - the "needs attention" queue on the
 * Exchange page is exactly the transactions where this is true.
 */
export function needsRateAttention(tx: Transaction): boolean {
  return tx.conversion?.source === 'fallback';
}
