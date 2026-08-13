import { Account } from '../../domain/models/account';
import { Transaction, TransactionType } from '../../domain/models/transaction';

export interface TransactionFilters {
  accountId: string;
  categoryId: string;
  type: TransactionType | '';
  from: string;
  to: string;
  search: string;
  institutionId: string;
}

export const EMPTY_FILTERS: TransactionFilters = {
  accountId: '',
  categoryId: '',
  type: '',
  from: '',
  to: '',
  search: '',
  institutionId: ''
};

/**
 * Shared by the real-transaction list and the projected-occurrence list —
 * both are shaped closely enough to `Transaction` (a ProjectedTransaction
 * is a Transaction template plus a date, minus an id) that one predicate
 * covers both. `accountsById` resolves each leg's account so the
 * institution predicate can look up `Account.institutionId` — Transaction
 * itself carries no institution field.
 */
export function matchesFilters(
  tx: Pick<Transaction, 'type' | 'accountId' | 'toAccountId' | 'categoryId' | 'description' | 'date'>,
  filters: TransactionFilters,
  accountsById: Map<string, Account>
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
  if (filters.institutionId) {
    const fromInstitutionId = accountsById.get(tx.accountId)?.institutionId;
    const toInstitutionId = tx.toAccountId ? accountsById.get(tx.toAccountId)?.institutionId : undefined;
    if (fromInstitutionId !== filters.institutionId && toInstitutionId !== filters.institutionId) {
      return false;
    }
  }
  return true;
}
