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

/** Number of categories that belong to a group. */
export interface CategoryGroupUsage {
  categories: number;
}

export function categoryGroupUsage(groupId: string, categories: Category[]): CategoryGroupUsage {
  return { categories: categories.filter((c) => c.groupId === groupId).length };
}

export function isCategoryGroupDeletable(usage: CategoryGroupUsage): boolean {
  return usage.categories === 0;
}
