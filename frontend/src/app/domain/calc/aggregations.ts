import { Account } from '../models/account';
import { Category } from '../models/category';
import { Transaction } from '../models/transaction';
import { add, compare, Money, money, sum, subtract, zero } from '../../shared/money/money';
import { accountBalance } from './balances';
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
      .map((tx) => convert(money(tx.amount, tx.currency), targetCurrency)),
    targetCurrency
  );
  const expense = sum(
    transactions
      .filter((tx) => tx.type === 'expense')
      .map((tx) => convert(money(tx.amount, tx.currency), targetCurrency)),
    targetCurrency
  );

  return { income, expense, net: subtract(income, expense) };
}

/**
 * The top-level category a category belongs to - itself if it has no
 * parent, its parent if it does (categories nest one level deep - see the
 * Category model). Shared by `categoryBreakdown` here and by
 * domain/calc/budgets.ts, which rolls child-category spend up into a
 * parent's budget the same way.
 */
export function topLevelCategoryId(categoryId: string, categories: readonly Category[]): string {
  const category = categories.find((c) => c.id === categoryId);
  return category?.parentId ?? categoryId;
}

export interface CategoryTotal {
  categoryId: string;
  total: Money;
}

/**
 * Expense total per top-level category, largest first. Child categories'
 * spend rolls up into their parent, so a "Transporte" parent's total
 * includes whatever was spent directly on "Transporte" plus its
 * "Uber"/"Combustível" children.
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
    const topLevelId = topLevelCategoryId(tx.categoryId, categories);
    const converted = convert(money(tx.amount, tx.currency), targetCurrency);
    totals.set(topLevelId, add(totals.get(topLevelId) ?? zero(targetCurrency), converted));
  }

  return Array.from(totals, ([categoryId, total]) => ({ categoryId, total })).sort((a, b) =>
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

/** Sum of every non-archived account's balance, converted to one display currency. */
export function netWorth(
  accounts: readonly Account[],
  transactions: readonly Transaction[],
  targetCurrency: string,
  convert: CurrencyConverter = identityConverter
): Money {
  const balances = accounts
    .filter((account) => !account.archived)
    .map((account) => convert(accountBalance(account, transactions), targetCurrency));

  return sum(balances, targetCurrency);
}
