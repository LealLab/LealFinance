import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { BudgetRepository } from '../budget.repository';
import { Budget } from '../../domain/models/budget';
import { MOCK_LATENCY_MS } from './mock-latency';
import { mockResult } from './mock-result';
import { MockStore } from './mock-store';

@Injectable({ providedIn: 'root' })
export class MockBudgetRepository extends BudgetRepository {
  private readonly store = inject(MockStore);
  private readonly latencyMs = inject(MOCK_LATENCY_MS);

  list(): Observable<Budget[]> {
    return mockResult(() => this.store.budgets(), this.latencyMs);
  }

  upsert(input: Omit<Budget, 'id'>): Observable<Budget> {
    return mockResult(() => this.store.upsertBudget(input), this.latencyMs);
  }

  delete(id: string): Observable<void> {
    return mockResult(() => this.store.deleteBudget(id), this.latencyMs);
  }
}
