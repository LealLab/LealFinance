import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { TransactionRepository } from '../transaction.repository';
import { Transaction } from '../../domain/models/transaction';
import { MOCK_LATENCY_MS } from './mock-latency';
import { mockResult } from './mock-result';
import { MockStore } from './mock-store';

@Injectable({ providedIn: 'root' })
export class MockTransactionRepository extends TransactionRepository {
  private readonly store = inject(MockStore);
  private readonly latencyMs = inject(MOCK_LATENCY_MS);

  list(): Observable<Transaction[]> {
    return mockResult(() => this.store.transactions(), this.latencyMs);
  }

  get(id: string): Observable<Transaction | undefined> {
    return mockResult(
      () => this.store.transactions().find((transaction) => transaction.id === id),
      this.latencyMs
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
}
