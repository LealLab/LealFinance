import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import {
  ImportPreview,
  TransactionCreateInput,
  TransactionFilters,
  TransactionRepository,
} from '../transaction.repository';
import { Page } from '../../core/api-client';
import { Transaction } from '../../domain/models/transaction';
import { addMonthsClamped, formatIsoDate, parseIsoDate } from '../../domain/calc/dates';
import { compare, money } from '../../shared/money/money';
import { MOCK_LATENCY_MS } from './mock-latency';
import { mockResult } from './mock-result';
import { MockStore } from './mock-store';

@Injectable({ providedIn: 'root' })
export class MockTransactionRepository extends TransactionRepository {
  private readonly store = inject(MockStore);
  private readonly latencyMs = inject(MOCK_LATENCY_MS);

  private filtered(filters: TransactionFilters): Transaction[] {
    const institutionAccountIds = filters.institutionId
      ? new Set(
          this.store
            .accounts()
            .filter((account) => account.institutionId === filters.institutionId)
            .map((account) => account.id),
        )
      : undefined;
    const groupCategoryIds = filters.groupId
      ? new Set(
          this.store
            .categories()
            .filter((category) => category.groupId === filters.groupId)
            .map((category) => category.id),
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
          (!filters.installmentGroupId ||
            transaction.installmentGroupId === filters.installmentGroupId) &&
          (!filters.categoryId || transaction.categoryId === filters.categoryId) &&
          (!groupCategoryIds ||
            (transaction.categoryId !== undefined &&
              groupCategoryIds.has(transaction.categoryId))) &&
          (!filters.types || filters.types.includes(transaction.type)) &&
          (!filters.dateFrom || transaction.date >= filters.dateFrom) &&
          (!filters.dateTo || transaction.date <= filters.dateTo) &&
          (!search || transaction.description.toLowerCase().includes(search)) &&
          (filters.amountMin === undefined ||
            compare(
              money(transaction.amount, transaction.currency),
              money(filters.amountMin, transaction.currency),
            ) >= 0) &&
          (filters.amountMax === undefined ||
            compare(
              money(transaction.amount, transaction.currency),
              money(filters.amountMax, transaction.currency),
            ) <= 0) &&
          (!institutionAccountIds ||
            institutionAccountIds.has(transaction.accountId) ||
            (transaction.toAccountId !== undefined &&
              institutionAccountIds.has(transaction.toAccountId))),
      );

    const order = filters.order ?? 'desc';
    const sign = order === 'asc' ? -1 : 1;
    // id desc as the tiebreaker on every sort, matching
    // app/services/transactions.py::list_transactions.
    return rows.sort((a, b) => {
      let primary: number;
      if (filters.sort === 'description') {
        primary = b.description.localeCompare(a.description);
      } else if (filters.sort === 'amount') {
        primary = compare(money(b.amount, b.currency), money(a.amount, a.currency));
      } else {
        primary = b.date.localeCompare(a.date);
      }
      return sign * primary || b.id.localeCompare(a.id);
    });
  }

  list(filters: TransactionFilters = {}): Observable<Transaction[]> {
    return mockResult(() => {
      const rows = this.filtered(filters);
      if (filters.limit === undefined) return rows;
      return rows.slice(filters.offset ?? 0, (filters.offset ?? 0) + filters.limit);
    }, this.latencyMs);
  }

  listPage(filters: TransactionFilters): Observable<Page<Transaction>> {
    return mockResult(() => {
      const rows = this.filtered(filters);
      const offset = filters.offset ?? 0;
      const items =
        filters.limit === undefined ? rows : rows.slice(offset, offset + filters.limit);
      return { items, total: rows.length };
    }, this.latencyMs);
  }

  get(id: string): Observable<Transaction | undefined> {
    return mockResult(
      () => this.store.transactions().find((transaction) => transaction.id === id),
      this.latencyMs,
    );
  }

  create(input: TransactionCreateInput): Observable<Transaction> {
    return mockResult(() => {
      const { installments, ...transaction } = input;
      if (!installments || installments < 2) return this.store.createTransaction(transaction);
      // Mirror app/services/transactions.py::_create_installments: N rows,
      // one per month, base amount to 4dp with the remainder on the first.
      const total = money(transaction.amount, transaction.currency);
      const base = money(
        (Number(total.amount) / installments).toFixed(4),
        transaction.currency,
      );
      const remainder = Number(total.amount) - Number(base.amount) * installments;
      const groupId = `inst-${Date.now()}`;
      const start = parseIsoDate(transaction.date);
      let first: Transaction | undefined;
      for (let k = 0; k < installments; k++) {
        const row = this.store.createTransaction({
          ...transaction,
          date: formatIsoDate(addMonthsClamped(start, k)),
          amount: (Number(base.amount) + (k === 0 ? remainder : 0)).toFixed(4),
          installmentGroupId: groupId,
          installmentNumber: k + 1,
          installmentCount: installments,
        });
        first ??= row;
      }
      return first!;
    }, this.latencyMs);
  }

  update(id: string, changes: Partial<Omit<Transaction, 'id'>>): Observable<Transaction> {
    return mockResult(() => this.store.updateTransaction(id, changes), this.latencyMs);
  }

  delete(id: string): Observable<void> {
    return mockResult(() => this.store.deleteTransaction(id), this.latencyMs);
  }

  bulkDelete(ids: readonly string[]): Observable<void> {
    return mockResult(() => {
      for (const id of ids) this.store.deleteTransaction(id);
    }, this.latencyMs);
  }

  bulkCategorize(ids: readonly string[], categoryId: string): Observable<void> {
    return mockResult(() => {
      for (const id of ids) this.store.updateTransaction(id, { categoryId });
    }, this.latencyMs);
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
