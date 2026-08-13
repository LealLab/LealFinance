import { Budget } from '../models/budget';
import { Category } from '../models/category';
import { Transaction } from '../models/transaction';

/** Per-kind counts of what still references a category — see `isCategoryDeletable`. */
export interface CategoryUsage {
  transactions: number;
  budgets: number;
  children: number;
}

/**
 * Counts everything that references `categoryId`, so the UI can explain
 * *why* a delete is blocked (see CategoryRepository's class doc) rather
 * than just refusing it.
 */
export function categoryUsage(
  categoryId: string,
  categories: Category[],
  transactions: Transaction[],
  budgets: Budget[]
): CategoryUsage {
  return {
    transactions: transactions.filter((t) => t.categoryId === categoryId).length,
    budgets: budgets.filter((b) => b.categoryId === categoryId).length,
    children: categories.filter((c) => c.parentId === categoryId).length
  };
}

/** A category is safe to delete only when nothing references it at all. */
export function isCategoryDeletable(usage: CategoryUsage): boolean {
  return usage.transactions === 0 && usage.budgets === 0 && usage.children === 0;
}
