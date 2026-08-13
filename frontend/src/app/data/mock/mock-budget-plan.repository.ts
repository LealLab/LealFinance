import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { BudgetPlanRepository } from '../budget-plan.repository';
import { BudgetAllocation, ExpectedIncome } from '../../domain/models/budget-plan';
import { MOCK_LATENCY_MS } from './mock-latency';
import { mockResult } from './mock-result';
import { MockStore } from './mock-store';

@Injectable({ providedIn: 'root' })
export class MockBudgetPlanRepository extends BudgetPlanRepository {
  private readonly store = inject(MockStore);
  private readonly latencyMs = inject(MOCK_LATENCY_MS);

  listAllocations(): Observable<BudgetAllocation[]> {
    return mockResult(() => this.store.allocations(), this.latencyMs);
  }

  upsertAllocation(input: Omit<BudgetAllocation, 'id'>): Observable<BudgetAllocation> {
    return mockResult(() => this.store.upsertAllocation(input), this.latencyMs);
  }

  deleteAllocation(id: string): Observable<void> {
    return mockResult(() => this.store.deleteAllocation(id), this.latencyMs);
  }

  listExpectedIncome(): Observable<ExpectedIncome[]> {
    return mockResult(() => this.store.expectedIncome(), this.latencyMs);
  }

  upsertExpectedIncome(input: Omit<ExpectedIncome, 'id'>): Observable<ExpectedIncome> {
    return mockResult(() => this.store.upsertExpectedIncome(input), this.latencyMs);
  }
}
