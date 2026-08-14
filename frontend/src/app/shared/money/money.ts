/**
 * Currency-aware decimal arithmetic for monetary amounts.
 *
 * Amounts travel as decimal *strings* everywhere in this app (matching the
 * backend's NUMERIC(19,4) columns and JSON-string wire format - see
 * docs/money-and-currency.md), and every operation here works on those
 * strings via `bigint` minor units rather than JS `number`, so nothing
 * routes through IEEE-754 float precision. `toNumber` is the one
 * deliberate exception - it exists solely for the display/chart boundary
 * (Chart.js datasets, percentage math) and is documented as such at its
 * call sites.
 *
 * Every binary operation asserts its two operands share a currency and
 * throws otherwise - mixing currencies without an explicit conversion
 * (`multiply`, driven by an exchange rate) is a bug, not a valid state.
 */

/** A monetary amount paired with its ISO 4217 currency code. */
export interface Money {
  readonly amount: string;
  readonly currency: string;
}

const SCALE = 4;
const SCALE_FACTOR = 10n ** BigInt(SCALE);
const DECIMAL_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/;

/** Parses a decimal string into minor units (scale 4), rounding half away from zero if given more precision than that. */
function parseToMinorUnits(decimal: string): bigint {
  const match = DECIMAL_PATTERN.exec(decimal.trim());
  if (!match) {
    throw new Error(`Invalid decimal amount: "${decimal}"`);
  }
  const [, sign, whole, fraction = ''] = match;
  const kept = fraction.slice(0, SCALE).padEnd(SCALE, '0');
  let minor = BigInt(whole) * SCALE_FACTOR + BigInt(kept);

  const roundingDigit = fraction.charAt(SCALE);
  if (roundingDigit !== '' && Number(roundingDigit) >= 5) {
    minor += 1n;
  }

  return sign === '-' ? -minor : minor;
}

/** Formats minor units back into a canonical fixed-scale decimal string, e.g. "1234.5000". */
function formatFromMinorUnits(minor: bigint): string {
  const negative = minor < 0n;
  const magnitude = negative ? -minor : minor;
  const whole = magnitude / SCALE_FACTOR;
  const fraction = (magnitude % SCALE_FACTOR).toString().padStart(SCALE, '0');
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

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch: cannot combine ${a.currency} with ${b.currency}`);
  }
}

/** Constructs a canonicalized Money value from a decimal string. */
export function money(amount: string, currency: string): Money {
  return { amount: formatFromMinorUnits(parseToMinorUnits(amount)), currency };
}

/** Zero in the given currency - the identity for `add`/`sum`. */
export function zero(currency: string): Money {
  return { amount: formatFromMinorUnits(0n), currency };
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(
    formatFromMinorUnits(parseToMinorUnits(a.amount) + parseToMinorUnits(b.amount)),
    a.currency
  );
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(
    formatFromMinorUnits(parseToMinorUnits(a.amount) - parseToMinorUnits(b.amount)),
    a.currency
  );
}

export function negate(a: Money): Money {
  return money(formatFromMinorUnits(-parseToMinorUnits(a.amount)), a.currency);
}

/** Sums a list of same-currency amounts; an empty list sums to zero in `currency`. */
export function sum(amounts: readonly Money[], currency: string): Money {
  return amounts.reduce((total, next) => add(total, next), zero(currency));
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  const diff = parseToMinorUnits(a.amount) - parseToMinorUnits(b.amount);
  if (diff === 0n) return 0;
  return diff > 0n ? 1 : -1;
}

export function isZero(a: Money): boolean {
  return parseToMinorUnits(a.amount) === 0n;
}

export function isNegative(a: Money): boolean {
  return parseToMinorUnits(a.amount) < 0n;
}

/**
 * Converts an amount by a decimal exchange-rate factor into another
 * currency. The factor arrives as a string (matching ExchangeRateQuote's
 * wire format) and is parsed the same way any amount is - rounded to
 * scale 4 - before the multiplication happens in bigint space; the
 * product is then rescaled back down to scale 4, rounding again if the
 * exact product isn't a multiple of the scale factor.
 */
export function multiply(a: Money, factor: string, resultCurrency: string): Money {
  const amountMinor = parseToMinorUnits(a.amount);
  const factorMinor = parseToMinorUnits(factor);
  const rescaled = roundDiv(amountMinor * factorMinor, SCALE_FACTOR);
  return money(formatFromMinorUnits(rescaled), resultCurrency);
}

/**
 * Plain-number ratio of two same-currency amounts (`a ÷ b`) - for progress
 * bars and percentages only, per the `toNumber` display-boundary rule
 * above. A zero `b` follows normal JS division semantics (±Infinity or
 * NaN for 0÷0); callers with a meaningful zero-budget case (see
 * domain/calc/budgets.ts) handle that explicitly rather than relying on
 * this function to guess their intent.
 */
export function ratio(a: Money, b: Money): number {
  assertSameCurrency(a, b);
  return toNumber(a) / toNumber(b);
}

/**
 * Converts to a JS number - the display/chart boundary only (Chart.js
 * datasets, percentage math). float64 is exact well past any realistic
 * account balance, but this is deliberately not where precision
 * guarantees live; see the module doc comment above.
 */
export function toNumber(a: Money): number {
  return Number(a.amount);
}
