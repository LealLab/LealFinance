/**
 * Exchange-rate arithmetic, split out from money.ts because a rate needs
 * more precision than a monetary amount: this app's amounts round to scale
 * 4 (matching the backend's NUMERIC(19,4)), but rates are stored at scale
 * 10 (matching NUMERIC(19,10) - see backend/app/models/types.ts). Parsing a
 * rate like "0.1923076923" at money.ts's scale 4 would truncate it to
 * "0.1923" before it's ever used, so this module carries its own bigint
 * decimal machinery at scale 10, structured the same way money.ts does.
 *
 * Every result that represents a monetary amount still goes through
 * `money()` to canonicalize back to scale 4 - only the rate itself is kept
 * at scale 10.
 */

import { Money, money } from './money';

const RATE_SCALE = 10;
const RATE_SCALE_FACTOR = 10n ** BigInt(RATE_SCALE);
const MONEY_SCALE = 4;
const MONEY_SCALE_FACTOR = 10n ** BigInt(MONEY_SCALE);
const DECIMAL_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/;

/** Parses a decimal string into fixed-point units at `scale`, rounding half away from zero if given more precision than that. */
function parseDecimalToUnits(decimal: string, scale: number, scaleFactor: bigint): bigint {
  const match = DECIMAL_PATTERN.exec(decimal.trim());
  if (!match) {
    throw new Error(`Invalid decimal amount: "${decimal}"`);
  }
  const [, sign, whole, fraction = ''] = match;
  const kept = fraction.slice(0, scale).padEnd(scale, '0');
  let units = BigInt(whole) * scaleFactor + BigInt(kept);

  const roundingDigit = fraction.charAt(scale);
  if (roundingDigit !== '' && Number(roundingDigit) >= 5) {
    units += 1n;
  }

  return sign === '-' ? -units : units;
}

/** Formats fixed-point units at `scale` back into a canonical decimal string. */
function formatUnitsToDecimal(units: bigint, scale: number, scaleFactor: bigint): string {
  const negative = units < 0n;
  const magnitude = negative ? -units : units;
  const whole = magnitude / scaleFactor;
  const fraction = (magnitude % scaleFactor).toString().padStart(scale, '0');
  const sign = negative && magnitude !== 0n ? '-' : '';
  return `${sign}${whole}.${fraction}`;
}

/** Rounds a bigint division half away from zero. */
function roundDiv(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const absNumerator = numerator < 0n ? -numerator : numerator;
  const absDenominator = denominator < 0n ? -denominator : denominator;
  const quotient = absNumerator / absDenominator;
  const remainder = absNumerator % absDenominator;
  const rounded = remainder * 2n >= absDenominator ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

/**
 * Converts `amount` by a decimal exchange-rate factor (parsed at scale 10)
 * into `currency`. The exact product is rescaled back down to money's
 * scale 4, rounding half away from zero if it isn't already a multiple of
 * the scale factor.
 */
export function convertByRate(amount: Money, rate: string, currency: string): Money {
  const amountUnits = parseDecimalToUnits(amount.amount, MONEY_SCALE, MONEY_SCALE_FACTOR);
  const rateUnits = parseDecimalToUnits(rate, RATE_SCALE, RATE_SCALE_FACTOR);
  const rescaled = roundDiv(amountUnits * rateUnits, RATE_SCALE_FACTOR);
  return money(formatUnitsToDecimal(rescaled, MONEY_SCALE, MONEY_SCALE_FACTOR), currency);
}

/**
 * Inverts a rate (1 ÷ rate), rounded to scale 10. Lets a single manually
 * entered rate for one direction of a pair (e.g. USD→BRL) answer the
 * opposite direction (BRL→USD) too.
 */
export function invertRate(rate: string): string {
  const units = parseDecimalToUnits(rate, RATE_SCALE, RATE_SCALE_FACTOR);
  if (units === 0n) {
    throw new Error('Cannot invert a zero rate');
  }
  const inverted = roundDiv(RATE_SCALE_FACTOR * RATE_SCALE_FACTOR, units);
  return formatUnitsToDecimal(inverted, RATE_SCALE, RATE_SCALE_FACTOR);
}

/**
 * Derives the rate implied by converting `from` into `to` (`to ÷ from`),
 * rounded to scale 10. Used to record what rate a manually entered
 * converted amount actually implies.
 */
export function effectiveRate(from: Money, to: Money): string {
  const fromUnits = parseDecimalToUnits(from.amount, MONEY_SCALE, MONEY_SCALE_FACTOR);
  if (fromUnits === 0n) {
    throw new Error('Cannot derive a rate from a zero origin amount');
  }
  const toUnits = parseDecimalToUnits(to.amount, MONEY_SCALE, MONEY_SCALE_FACTOR);
  const rateUnits = roundDiv(toUnits * RATE_SCALE_FACTOR, fromUnits);
  return formatUnitsToDecimal(rateUnits, RATE_SCALE, RATE_SCALE_FACTOR);
}
