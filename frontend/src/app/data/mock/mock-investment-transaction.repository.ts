import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { InvestmentTransaction } from '../../domain/models/investment';
import {
  InvestmentTransactionCreate,
  InvestmentTransactionRepository,
  InvestmentTransactionUpdate,
} from '../investment-transaction.repository';
import { MOCK_LATENCY_MS } from './mock-latency';
import { mockResult } from './mock-result';
import { MockStore } from './mock-store';

@Injectable({ providedIn: 'root' })
export class MockInvestmentTransactionRepository extends InvestmentTransactionRepository {
  private readonly store = inject(MockStore);
  private readonly latencyMs = inject(MOCK_LATENCY_MS);

  list(params: {
    walletId: string;
    limit?: number;
    offset?: number;
  }): Observable<InvestmentTransaction[]> {
    return mockResult(() => {
      const rows = this.store
        .investmentTransactions()
        .filter((transaction) => transaction.walletId === params.walletId)
        .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
      if (params.limit === undefined) return rows;
      return rows.slice(params.offset ?? 0, (params.offset ?? 0) + params.limit);
    }, this.latencyMs);
  }

  create(input: InvestmentTransactionCreate): Observable<InvestmentTransaction> {
    return mockResult(
      () => this.store.createInvestmentTransaction(input),
      this.latencyMs,
    );
  }

  update(id: string, changes: InvestmentTransactionUpdate): Observable<InvestmentTransaction> {
    return mockResult(
      () => this.store.updateInvestmentTransaction(id, changes),
      this.latencyMs,
    );
  }

  delete(id: string): Observable<void> {
    return mockResult(() => this.store.deleteInvestmentTransaction(id), this.latencyMs);
  }
}
