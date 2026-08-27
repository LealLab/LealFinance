import { Budget } from '../models/budget';
import { BudgetAllocation } from '../models/budget-plan';
import { Category } from '../models/category';
import { Transaction } from '../models/transaction';

/** Number of transactions that reference a category. */
export interface CategoryUsage {
  transactions: number;
}

export function categoryUsage(categoryId: string, transactions: Transaction[]): CategoryUsage {
  return { transactions: transactions.filter((t) => t.categoryId === categoryId).length };
}

export function isCategoryDeletable(usage: CategoryUsage): boolean {
  return usage.transactions === 0;
}

/**
 * Number of categories, budgets, and budget allocations that reference a
 * group - mirrors the backend's own guard (see
 * app/services/category_groups.py `_group_in_use`), which blocks deletion on
 * any of the three, not just categories.
 */
export interface CategoryGroupUsage {
  categories: number;
  budgets: number;
  allocations: number;
}

export function categoryGroupUsage(
  groupId: string,
  categories: Category[],
  budgets: Budget[],
  allocations: BudgetAllocation[]
): CategoryGroupUsage {
  return {
    categories: categories.filter((c) => c.groupId === groupId).length,
    budgets: budgets.filter((b) => b.groupId === groupId).length,
    allocations: allocations.filter((a) => a.groupId === groupId).length
  };
}

export function isCategoryGroupDeletable(usage: CategoryGroupUsage): boolean {
  return usage.categories === 0 && usage.budgets === 0 && usage.allocations === 0;
}
