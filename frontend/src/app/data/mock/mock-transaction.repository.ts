import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import {
  ImportPreview,
  TransactionFilters,
  TransactionRepository,
} from '../transaction.repository';
import { Transaction } from '../../domain/models/transaction';
import { MOCK_LATENCY_MS } from './mock-latency';
import { mockResult } from './mock-result';
import { MockStore } from './mock-store';

@Injectable({ providedIn: 'root' })
export class MockTransactionRepository extends TransactionRepository {
  private readonly store = inject(MockStore);
  private readonly latencyMs = inject(MOCK_LATENCY_MS);

  list(filters: TransactionFilters = {}): Observable<Transaction[]> {
    return mockResult(() => {
      const institutionAccountIds = filters.institutionId
        ? new Set(
            this.store
              .accounts()
              .filter((account) => account.institutionId === filters.institutionId)
              .map((account) => account.id),
          )
        : undefined;
      const search = filters.search?.toLowerCase();

      const rows = this.store
        .transactions()
        .filter(
          (transaction) =>
            (!filters.accountId ||
              transaction.accountId === filters.accountId ||
              transaction.toAccountId === filters.accountId) &&
            (!filters.categoryId || transaction.categoryId === filters.categoryId) &&
            (!filters.types || filters.types.includes(transaction.type)) &&
            (!filters.dateFrom || transaction.date >= filters.dateFrom) &&
            (!filters.dateTo || transaction.date <= filters.dateTo) &&
            (!search || transaction.description.toLowerCase().includes(search)) &&
            (!institutionAccountIds ||
              institutionAccountIds.has(transaction.accountId) ||
              (transaction.toAccountId !== undefined &&
                institutionAccountIds.has(transaction.toAccountId))),
        )
        // Same tiebreaker the backend applies (date desc, id desc) - see
        // app/services/transactions.py::list_transactions.
        .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));

      if (filters.limit === undefined) return rows;
      return rows.slice(filters.offset ?? 0, (filters.offset ?? 0) + filters.limit);
    }, this.latencyMs);
  }

  get(id: string): Observable<Transaction | undefined> {
    return mockResult(
      () => this.store.transactions().find((transaction) => transaction.id === id),
      this.latencyMs,
    );
  }

  create(input: Omit<Transaction, 'id'>): Observable<Transaction> {
    return mockResult(() => this.store.createTransaction(input), this.latencyMs);
  }

  update(id: string, changes: Partial<Omit<Transaction, 'id'>>): Observable<Transaction> {
    return mockResult(() => this.store.updateTransaction(id, changes), this.latencyMs);
  }

  delete(id: string): Observable<void> {
    return mockResult(() => this.store.deleteTransaction(id), this.latencyMs);
  }

  // Parsing a real CSV is server-side work with no mock equivalent - this
  // repository is a test double, not a second parser implementation.
  importPreview(): Observable<ImportPreview> {
    return mockResult(() => ({ headers: [], mapping: {}, rows: [] }), this.latencyMs);
  }
  importCommit(items: readonly Omit<Transaction, 'id'>[]): Observable<number> {
    return mockResult(() => {
      for (const item of items) this.store.createTransaction(item);
      return items.length;
    }, this.latencyMs);
  }
}
