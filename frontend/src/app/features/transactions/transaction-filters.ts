import { Transaction, TransactionType } from '../../domain/models/transaction';

export interface TransactionFilters {
  accountId: string;
  categoryId: string;
  type: TransactionType | '';
  from: string;
  to: string;
  search: string;
}

export const EMPTY_FILTERS: TransactionFilters = {
  accountId: '',
  categoryId: '',
  type: '',
  from: '',
  to: '',
  search: ''
};

/**
 * Shared by the real-transaction list and the projected-occurrence list —
 * both are shaped closely enough to `Transaction` (a ProjectedTransaction
 * is a Transaction template plus a date, minus an id) that one predicate
 * covers both.
 */
export function matchesFilters(
  tx: Pick<Transaction, 'type' | 'accountId' | 'toAccountId' | 'categoryId' | 'description' | 'date'>,
  filters: TransactionFilters
): boolean {
  if (filters.type && tx.type !== filters.type) return false;
  if (filters.accountId && tx.accountId !== filters.accountId && tx.toAccountId !== filters.accountId) {
    return false;
  }
  if (filters.categoryId && tx.categoryId !== filters.categoryId) return false;
  if (filters.from && tx.date < filters.from) return false;
  if (filters.to && tx.date > filters.to) return false;
  if (filters.search && !tx.description.toLowerCase().includes(filters.search.toLowerCase())) {
    return false;
  }
  return true;
}
