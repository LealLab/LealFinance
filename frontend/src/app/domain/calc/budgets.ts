import { Budget } from '../models/budget';
import { Category } from '../models/category';
import { Transaction } from '../models/transaction';
import { isZero, Money, money, ratio as moneyRatio, subtract, sum } from '../../shared/money/money';
import {
  categoryBreakdown,
  categoryGroupId,
  CurrencyConverter,
  identityConverter
} from './aggregations';
import { effectiveAmount } from './conversion';
import { monthKey } from './dates';

export type BudgetState = 'under' | 'near' | 'over';

export interface BudgetProgress {
  groupId: string;
  budgeted: Money;
  spent: Money;
  remaining: Money;
  /**
   * spent ÷ budgeted. A zero budget is a real state (someone budgeted
   * R$0 for a category on purpose) rather than an error, so this never
   * throws or divides by zero: 0 with nothing spent, `Infinity` with
   * anything spent at all - both read as "over" for display purposes,
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
 * How a single group budget is tracking against actual spend. Category
 * spend rolls up into the group - see `categoryGroupId` - matching how
 * `categoryBreakdown` reports spend on the dashboard/reports screens.
 */
export function budgetProgress(
  budget: Budget,
  transactions: readonly Transaction[],
  categories: readonly Category[],
  convert: CurrencyConverter = identityConverter
): BudgetProgress {
  const matches = (tx: Transaction): boolean => {
    if (tx.type !== 'expense' || !tx.categoryId || monthKey(tx.date) !== budget.month) {
      return false;
    }
    return categoryGroupId(tx.categoryId, categories) === budget.groupId;
  };

  const budgeted = money(budget.amount, budget.currency);
  const spent = sum(
    transactions
      .filter(matches)
      .map((tx) => convert(effectiveAmount(tx), budget.currency)),
    budget.currency
  );
  const remaining = subtract(budgeted, spent);
  const ratio = isZero(budgeted) ? (isZero(spent) ? 0 : Infinity) : moneyRatio(spent, budgeted);

  return { groupId: budget.groupId, budgeted, spent, remaining, ratio, state: stateFor(ratio) };
}

export interface UnbudgetedSpend {
  groupId: string;
  spent: Money;
}

/**
 * Category groups with expense in `month` but no Budget entry for
 * that month at all - the "spent here without a plan" list on the
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
  const budgetedGroupIds = new Set(
    budgets
      .filter((budget) => budget.month === month)
      .map((budget) => budget.groupId)
  );

  const monthTransactions = transactions.filter((tx) => monthKey(tx.date) === month);
  const breakdown = categoryBreakdown(monthTransactions, categories, targetCurrency, convert);

  return breakdown
    .filter((entry) => !budgetedGroupIds.has(entry.groupId))
    .map((entry) => ({ groupId: entry.groupId, spent: entry.total }));
}
