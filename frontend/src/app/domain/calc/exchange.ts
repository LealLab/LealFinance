import { Transaction } from '../models/transaction';
import { Money, sum } from '../../shared/money/money';
import { CurrencyConverter, identityConverter } from './aggregations';
import { conversionFee, needsRateAttention } from './conversion';

/**
 * Total conversion fees paid across `transactions`, converted into
 * `targetCurrency` - the Exchange page's "how much did I lose to
 * conversion fees" stat. Each fee is read from its transaction's own
 * origin currency (see conversion.ts's `conversionFee`), so this needs a
 * real converter whenever any fee isn't already in `targetCurrency`.
 */
export function totalConversionFees(
  transactions: readonly Transaction[],
  targetCurrency: string,
  convert: CurrencyConverter = identityConverter
): Money {
  const fees = transactions
    .map((tx) => conversionFee(tx))
    .filter((fee): fee is Money => fee !== null)
    .map((fee) => convert(fee, targetCurrency));
  return sum(fees, targetCurrency);
}

/** Transactions whose conversion used a 1:1 fallback rate - the Exchange page's "needs attention" queue. */
export function transactionsNeedingAttention(transactions: readonly Transaction[]): Transaction[] {
  return transactions.filter((tx) => needsRateAttention(tx));
}
