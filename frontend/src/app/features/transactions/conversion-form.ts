import { ConversionSource, TransactionConversion } from '../../domain/models/transaction';
import { money, subtract, zero } from '../../shared/money/money';
import { convertByRate, effectiveRate } from '../../shared/money/rate';

/**
 * The two pieces of decision logic behind the transaction form's
 * "Conversion" fieldset - kept as pure functions, separate from the
 * component's form/effect wiring, so the money math (feature #3's
 * `converted = (amount - fee) * rate` rule) has a real unit test rather
 * than only being exercised by hand through the UI.
 */

/**
 * Prefills the converted-amount field from a live/mock rate, deducting the
 * fee (in the origin currency) before converting - see
 * docs/money-and-currency.md.
 */
export function prefillConvertedAmount(
  originAmount: string,
  originCurrency: string,
  fee: string | null,
  rate: string,
  destinationCurrency: string
): string {
  const origin = money(originAmount, originCurrency);
  const feeAmount = fee ? money(fee, originCurrency) : zero(originCurrency);
  const netOrigin = subtract(origin, feeAmount);
  return convertByRate(netOrigin, rate, destinationCurrency).amount;
}

export interface BuildConversionInput {
  originAmount: string;
  originCurrency: string;
  fee: string | null;
  convertedAmount: string;
  destinationCurrency: string;
  /** What the last live/mock quote for this pair said - used as `source` when the user left the prefill untouched. */
  quoteSource: Exclude<ConversionSource, 'manual'>;
  /** True once the user has typed into the converted-amount field themselves, rather than accepting the prefill. */
  convertedTouched: boolean;
}

/**
 * Builds the `TransactionConversion` to record on submit. The rate is
 * derived from what was actually entered (net of the fee) rather than
 * re-reading the live quote, so it stays accurate even after the user
 * edits the converted amount by hand.
 */
export function buildTransactionConversion(input: BuildConversionInput): TransactionConversion {
  const origin = money(input.originAmount, input.originCurrency);
  const fee = input.fee ? money(input.fee, input.originCurrency) : null;
  const netOrigin = fee ? subtract(origin, fee) : origin;
  const converted = money(input.convertedAmount, input.destinationCurrency);

  return {
    amount: converted.amount,
    currency: converted.currency,
    fee: fee?.amount,
    rate: effectiveRate(netOrigin, converted),
    source: input.convertedTouched ? 'manual' : input.quoteSource
  };
}
