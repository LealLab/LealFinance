import { inject, Injectable } from '@angular/core';
import { catchError, map, Observable } from 'rxjs';
import { ApiClient, ApiQueryParams } from '../../core/api-client';
import { Transaction } from '../../domain/models/transaction';
import { TransactionFilters, TransactionRepository } from '../transaction.repository';
import { mapTransaction, mapTransactionCreate, mapTransactionPatch } from './mappers';
import { notFoundOrThrow } from './repository-errors';
import { TransactionWire } from './wire-dtos';

@Injectable({ providedIn: 'root' })
export class HttpTransactionRepository extends TransactionRepository {
  private readonly api = inject(ApiClient);
  list(filters: TransactionFilters = {}): Observable<Transaction[]> {
    const params: ApiQueryParams = {
      account_id: filters.accountId,
      category_id: filters.categoryId,
      institution_id: filters.institutionId,
      type: filters.types,
      date_from: filters.dateFrom,
      date_to: filters.dateTo,
      search: filters.search,
      limit: filters.limit,
      offset: filters.offset,
    };
    return this.api
      .get<TransactionWire[]>('/transactions', params)
      .pipe(map((items) => items.map(mapTransaction)));
  }
  get(id: string): Observable<Transaction | undefined> {
    return this.api.get<TransactionWire>(`/transactions/${id}`).pipe(
      map(mapTransaction),
      catchError((e) => notFoundOrThrow<Transaction>(e, 'transaction.not_found')),
    );
  }
  create(input: Omit<Transaction, 'id'>): Observable<Transaction> {
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
}
