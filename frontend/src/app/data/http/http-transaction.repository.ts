import { inject, Injectable } from '@angular/core';
import { catchError, map, Observable } from 'rxjs';
import { ApiClient, ApiQueryParams, Page } from '../../core/api-client';
import { Transaction } from '../../domain/models/transaction';
import { ImportBatch } from '../../domain/models/import-batch';
import { TransactionHistoryEntry } from '../../domain/models/transaction-history';
import {
  ImportPreview,
  ImportPreviewRequest,
  TransactionCreateInput,
  TransactionFilters,
  TransactionRepository,
} from '../transaction.repository';
import {
  mapImportPreview,
  mapImportPreviewRequest,
  mapImportBatch,
  mapTransactionHistory,
  mapTransaction,
  mapTransactionCreate,
  mapTransactionPatch,
} from './mappers';
import { notFoundOrThrow } from './repository-errors';
import {
  ImportBatchWire,
  ImportCommitWire,
  ImportPreviewWire,
  TransactionHistoryWire,
  TransactionWire,
} from './wire-dtos';

@Injectable({ providedIn: 'root' })
export class HttpTransactionRepository extends TransactionRepository {
  private readonly api = inject(ApiClient);

  private toParams(filters: TransactionFilters): ApiQueryParams {
    return {
      account_id: filters.accountId,
      category_id: filters.categoryId,
      group_id: filters.groupId,
      institution_id: filters.institutionId,
      installment_group_id: filters.installmentGroupId,
      type: filters.types,
      date_from: filters.dateFrom,
      date_to: filters.dateTo,
      search: filters.search,
      amount_min: filters.amountMin,
      amount_max: filters.amountMax,
      sort: filters.sort,
      order: filters.order,
      limit: filters.limit,
      offset: filters.offset,
    };
  }

  list(filters: TransactionFilters = {}): Observable<Transaction[]> {
    return this.api
      .get<TransactionWire[]>('/transactions', this.toParams(filters))
      .pipe(map((items) => items.map(mapTransaction)));
  }

  listPage(filters: TransactionFilters): Observable<Page<Transaction>> {
    return this.api
      .getPage<TransactionWire>('/transactions', this.toParams(filters))
      .pipe(map((page) => ({ items: page.items.map(mapTransaction), total: page.total })));
  }
  get(id: string): Observable<Transaction | undefined> {
    return this.api.get<TransactionWire>(`/transactions/${id}`).pipe(
      map(mapTransaction),
      catchError((e) => notFoundOrThrow<Transaction>(e, 'transaction.not_found')),
    );
  }
  create(input: TransactionCreateInput): Observable<Transaction> {
    return this.api
      .post<TransactionWire>('/transactions', mapTransactionCreate(input))
      .pipe(map(mapTransaction));
  }
  update(id: string, changes: Partial<Omit<Transaction, 'id'>>): Observable<Transaction> {
    return this.api
      .patch<TransactionWire>(`/transactions/${id}`, mapTransactionPatch(changes))
      .pipe(map(mapTransaction));
  }
  delete(id: string): Observable<void> {
    return this.api.delete(`/transactions/${id}`);
  }
  bulkDelete(ids: readonly string[]): Observable<void> {
    return this.api.post<void>('/transactions/bulk-delete', { ids });
  }
  bulkCategorize(ids: readonly string[], categoryId: string): Observable<void> {
    return this.api
      .post<{ updated: number }>('/transactions/bulk-categorize', {
        ids,
        category_id: categoryId,
      })
      .pipe(map(() => undefined));
  }
  importPreview(request: ImportPreviewRequest): Observable<ImportPreview> {
    return this.api
      .post<ImportPreviewWire>('/transactions/import/preview', mapImportPreviewRequest(request))
      .pipe(map(mapImportPreview));
  }
  importCommit(items: readonly Omit<Transaction, 'id'>[], idempotencyKey: string): Observable<number> {
    return this.api
      .post<ImportCommitWire>('/transactions/import', {
        idempotency_key: idempotencyKey,
        items: items.map(mapTransactionCreate)
      })
      .pipe(map((wire) => wire.created));
  }
  history(id: string): Observable<TransactionHistoryEntry[]> {
    return this.api.get<TransactionHistoryWire[]>(`/transactions/${id}/history`).pipe(
      map((items) => items.map(mapTransactionHistory)),
      catchError((e) =>
        notFoundOrThrow<TransactionHistoryEntry[]>(e, 'transaction.not_found').pipe(
          map((items) => items ?? []),
        ),
      ),
    );
  }
  listImportBatches(): Observable<ImportBatch[]> {
    return this.api
      .get<ImportBatchWire[]>('/transactions/import/batches')
      .pipe(map((items) => items.map(mapImportBatch)));
  }
  importBatchTransactions(batchId: string): Observable<Transaction[]> {
    return this.api
      .get<TransactionWire[]>(`/transactions/import/batches/${batchId}`)
      .pipe(map((items) => items.map(mapTransaction)));
  }
  undoImportBatch(batchId: string): Observable<void> {
    return this.api.delete(`/transactions/import/batches/${batchId}`);
  }
}
