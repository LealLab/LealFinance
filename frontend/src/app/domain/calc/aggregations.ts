import { Account, AccountBalance } from '../models/account';
import { Category } from '../models/category';
import { ExchangeRate } from '../models/exchange-rate';
import { Transaction } from '../models/transaction';
import { add, compare, money, Money, multiply, sum, subtract, zero } from '../../shared/money/money';
import { effectiveAmount } from './conversion';
import { monthKey } from './dates';

/**
 * Converts an amount into `targetCurrency`. Every aggregation below takes
 * one of these rather than doing currency conversion itself - conversion
 * needs a live (or mock) exchange rate, which is IO, and these functions
 * stay pure. `identityConverter` is the default: it passes same-currency
 * amounts through and throws on anything else, so a caller that forgets
 * to supply a real converter fails loudly on the first cross-currency
 * amount instead of silently mislabeling it.
 */
export type CurrencyConverter = (amount: Money, targetCurrency: string) => Money;

export const identityConverter: CurrencyConverter = (amount, targetCurrency) => {
  if (amount.currency === targetCurrency) return amount;
  throw new Error(
    `No conversion available from ${amount.currency} to ${targetCurrency} (pass a real CurrencyConverter)`
  );
};

export interface PeriodTotals {
  income: Money;
  expense: Money;
  net: Money;
}

/**
 * Income/expense totals across a set of transactions. Transfers move
 * money between the user's own accounts rather than earning or spending
 * it, so they're excluded here - this is the one calculation most likely
 * to double-count if that filter is ever lost, which is why it's covered
 * explicitly in aggregations.spec.ts.
 */
export function totalsFor(
  transactions: readonly Transaction[],
  targetCurrency: string,
  convert: CurrencyConverter = identityConverter
): PeriodTotals {
  const income = sum(
    transactions
      .filter((tx) => tx.type === 'income')
      .map((tx) => convert(effectiveAmount(tx), targetCurrency)),
    targetCurrency
  );
  const expense = sum(
    transactions
      .filter((tx) => tx.type === 'expense')
      .map((tx) => convert(effectiveAmount(tx), targetCurrency)),
    targetCurrency
  );

  return { income, expense, net: subtract(income, expense) };
}

/**
 * The group a category belongs to, falling back to the category id when the
 * category is unknown. Shared by `categoryBreakdown` here and by
 * domain/calc/budgets.ts, which rolls category spend up into a group's budget.
 */
export function categoryGroupId(categoryId: string, categories: readonly Category[]): string {
  const category = categories.find((c) => c.id === categoryId);
  return category?.groupId ?? categoryId;
}

export interface CategoryTotal {
  groupId: string;
  total: Money;
}

/**
 * Expense total per category group, largest first. Every category's spend
 * rolls up to its group.
 */
export function categoryBreakdown(
  transactions: readonly Transaction[],
  categories: readonly Category[],
  targetCurrency: string,
  convert: CurrencyConverter = identityConverter
): CategoryTotal[] {
  const totals = new Map<string, Money>();
  for (const tx of transactions) {
    if (tx.type !== 'expense' || !tx.categoryId) continue;
    const groupId = categoryGroupId(tx.categoryId, categories);
    const converted = convert(effectiveAmount(tx), targetCurrency);
    totals.set(groupId, add(totals.get(groupId) ?? zero(targetCurrency), converted));
  }

  return Array.from(totals, ([groupId, total]) => ({ groupId, total })).sort((a, b) =>
    compare(b.total, a.total)
  );
}

/** Buckets transactions by their 'YYYY-MM' month, preserving input order within each bucket. */
export function groupByMonth(transactions: readonly Transaction[]): Map<string, Transaction[]> {
  const groups = new Map<string, Transaction[]>();
  for (const tx of transactions) {
    const key = monthKey(tx.date);
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(tx);
    } else {
      groups.set(key, [tx]);
    }
  }
  return groups;
}

/**
 * Sum of every non-archived account's balance, converted to one display
 * currency. Takes server-computed balances (see AccountRepository.balances())
 * rather than the full transaction ledger - callers no longer need to fetch
 * every transaction just to show a total.
 */
export function netWorth(
  accounts: readonly Account[],
  balances: readonly AccountBalance[],
  targetCurrency: string,
  convert: CurrencyConverter = identityConverter
): Money {
  const balanceByAccountId = new Map(balances.map((b) => [b.accountId, b]));
  const converted = accounts
    .filter((account) => !account.archived)
    .map((account) => {
      const balance = balanceByAccountId.get(account.id);
      return convert(
        balance ? money(balance.balance, balance.currency) : zero(account.currency),
        targetCurrency
      );
    });

  return sum(converted, targetCurrency);
}

/**
 * Sum server-computed cash-position contributions into the display currency.
 * Unlike `netWorth`, configured card rows already replace the raw card
 * balance with only invoices due by today; the currency and archive rules
 * stay identical.
 */
export function realBalance(
  accounts: readonly Account[],
  contributions: readonly AccountBalance[],
  targetCurrency: string,
  convert: CurrencyConverter = identityConverter
): Money {
  const contributionByAccountId = new Map(contributions.map((b) => [b.accountId, b]));
  return sum(
    accounts
      .filter((account) => !account.archived)
      .map((account) => {
        const contribution = contributionByAccountId.get(account.id);
        return convert(
          contribution ? money(contribution.balance, contribution.currency) : zero(account.currency),
          targetCurrency
        );
      }),
    targetCurrency
  );
}

/**
 * Builds a `CurrencyConverter` from a batch of fetched rates (one
 * `ExchangeRate` per currency, keyed by `baseCode`) - the shape every
 * screen gets back from forking a `ExchangeRateRepository.getRate()` call
 * per foreign currency in use (see features/dashboard/dashboard.ts for the
 * canonical fetch). Falls through to the original amount, unconverted, if
 * no rate covers its currency - the caller's problem to handle (or ignore
 * via `convertedOrNull` below), never this function's to throw over.
 */
export function converterFromRates(rates: readonly ExchangeRate[]): CurrencyConverter {
  const rateByPair = new Map(
    rates.map((rate) => [`${rate.baseCode}:${rate.quoteCode}`, rate]),
  );
  return (amount, targetCurrency) => {
    if (amount.currency === targetCurrency) return amount;
    const rate = rateByPair.get(`${amount.currency}:${targetCurrency}`);
    if (!rate) return amount;
    return multiply(amount, rate.rate, targetCurrency);
  };
}

/**
 * True when every `[source, target]` pair either names the same currency
 * twice (nothing to convert) or has a matching `base:quote` entry in
 * `rates` - the gate every aggregation caller (totalsFor,
 * categoryBreakdown, netWorth, budgetProgress) must check before
 * converting, because unlike `convertedOrNull` they feed the result into
 * `sum`/`add`/`compare`, which throw on a currency mismatch rather than
 * tolerating `converterFromRates`'s documented unconverted-passthrough. A
 * caller that builds its converter from a still-loading rates resource and
 * skips this check will crash the instant it aggregates a foreign-currency
 * amount - see dashboard.ts's `converter`/`ratesReady` pair for the
 * simple (single target currency) case, and budgets.ts's `conversionPairs`
 * for the multi-target one (budgetProgress converts into each budget's own
 * currency, not one shared display currency).
 */
export function pairsCovered(
  rates: readonly ExchangeRate[],
  pairs: readonly (readonly [string, string])[]
): boolean {
  const covered = new Set(rates.map((rate) => `${rate.baseCode}:${rate.quoteCode}`));
  return pairs.every(([source, target]) => source === target || covered.has(`${source}:${target}`));
}

/** `ratesCover(rates, currencies, target)` is `pairsCovered` for the common single-target-currency case. */
export function ratesCover(
  rates: readonly ExchangeRate[],
  currencies: readonly string[],
  targetCurrency: string
): boolean {
  return pairsCovered(
    rates,
    currencies.map((currency) => [currency, targetCurrency] as const)
  );
}

/**
 * Converts `amount` into `targetCurrency`, or `null` if it's already in
 * that currency *or* nothing was available to convert it (the converter
 * passed the original amount through unchanged - see `converterFromRates`
 * above). Built for "show the converted value alongside the original,
 * only when there's actually a second currency to show" UI: an account
 * balance or goal amount in a foreign currency, displayed next to its
 * display-currency equivalent.
 */
export function convertedOrNull(
  amount: Money,
  targetCurrency: string,
  convert: CurrencyConverter
): Money | null {
  if (amount.currency === targetCurrency) return null;
  const converted = convert(amount, targetCurrency);
  return converted.currency !== amount.currency ? converted : null;
}
