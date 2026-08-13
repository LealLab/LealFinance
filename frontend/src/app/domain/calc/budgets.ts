import { Budget } from '../models/budget';
import { Category } from '../models/category';
import { Transaction } from '../models/transaction';
import { isZero, Money, money, ratio as moneyRatio, subtract, sum } from '../../shared/money/money';
import {
  categoryBreakdown,
  CurrencyConverter,
  identityConverter,
  topLevelCategoryId
} from './aggregations';
import { monthKey } from './dates';

export type BudgetState = 'under' | 'near' | 'over';

export interface BudgetProgress {
  categoryId: string;
  budgeted: Money;
  spent: Money;
  remaining: Money;
  /**
   * spent ÷ budgeted. A zero budget is a real state (someone budgeted
   * R$0 for a category on purpose) rather than an error, so this never
   * throws or divides by zero: 0 with nothing spent, `Infinity` with
   * anything spent at all — both read as "over" for display purposes,
   * see `state`.
   */
  ratio: number;
  state: BudgetState;
}

function stateFor(ratio: number): BudgetState {
  if (ratio >= 1) return 'over';
  if (ratio >= 0.8) return 'near';
  return 'under';
}

/**
 * How a single budget is tracking against actual spend. If the budget is
 * on a top-level category, spend on its children rolls up into it too —
 * see `topLevelCategoryId` — matching how `categoryBreakdown` reports
 * spend on the dashboard/reports screens.
 */
export function budgetProgress(
  budget: Budget,
  transactions: readonly Transaction[],
  categories: readonly Category[],
  convert: CurrencyConverter = identityConverter
): BudgetProgress {
  const budgetIsTopLevel = topLevelCategoryId(budget.categoryId, categories) === budget.categoryId;

  const matches = (tx: Transaction): boolean => {
    if (tx.type !== 'expense' || !tx.categoryId || monthKey(tx.date) !== budget.month) {
      return false;
    }
    return budgetIsTopLevel
      ? topLevelCategoryId(tx.categoryId, categories) === budget.categoryId
      : tx.categoryId === budget.categoryId;
  };

  const budgeted = money(budget.amount, budget.currency);
  const spent = sum(
    transactions
      .filter(matches)
      .map((tx) => convert(money(tx.amount, tx.currency), budget.currency)),
    budget.currency
  );
  const remaining = subtract(budgeted, spent);
  const ratio = isZero(budgeted) ? (isZero(spent) ? 0 : Infinity) : moneyRatio(spent, budgeted);

  return { categoryId: budget.categoryId, budgeted, spent, remaining, ratio, state: stateFor(ratio) };
}

export interface UnbudgetedSpend {
  categoryId: string;
  spent: Money;
}

/**
 * Top-level categories with expense in `month` but no Budget entry for
 * that month at all — the "spent here without a plan" list on the
 * budgets screen.
 */
export function unbudgetedSpend(
  transactions: readonly Transaction[],
  categories: readonly Category[],
  budgets: readonly Budget[],
  month: string,
  targetCurrency: string,
  convert: CurrencyConverter = identityConverter
): UnbudgetedSpend[] {
  const budgetedTopLevelIds = new Set(
    budgets
      .filter((budget) => budget.month === month)
      .map((budget) => topLevelCategoryId(budget.categoryId, categories))
  );

  const monthTransactions = transactions.filter((tx) => monthKey(tx.date) === month);
  const breakdown = categoryBreakdown(monthTransactions, categories, targetCurrency, convert);

  return breakdown
    .filter((entry) => !budgetedTopLevelIds.has(entry.categoryId))
    .map((entry) => ({ categoryId: entry.categoryId, spent: entry.total }));
}
