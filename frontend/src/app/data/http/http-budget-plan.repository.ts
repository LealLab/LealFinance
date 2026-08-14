import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { ApiClient } from '../../core/api-client';
import { BudgetAllocation, ExpectedIncome } from '../../domain/models/budget-plan';
import { BudgetPlanRepository } from '../budget-plan.repository';
import {
  mapBudgetAllocation,
  mapBudgetAllocationInput,
  mapExpectedIncome,
  mapExpectedIncomeInput,
} from './mappers';
import { BudgetAllocationWire, ExpectedIncomeWire } from './wire-dtos';

@Injectable({ providedIn: 'root' })
export class HttpBudgetPlanRepository extends BudgetPlanRepository {
  private readonly api = inject(ApiClient);
  listAllocations(): Observable<BudgetAllocation[]> {
    return this.api
      .get<BudgetAllocationWire[]>('/budget-allocations')
      .pipe(map((items) => items.map(mapBudgetAllocation)));
  }
  upsertAllocation(input: Omit<BudgetAllocation, 'id'>): Observable<BudgetAllocation> {
    return this.api
      .put<BudgetAllocationWire>('/budget-allocations', mapBudgetAllocationInput(input))
      .pipe(map(mapBudgetAllocation));
  }
  deleteAllocation(id: string): Observable<void> {
    return this.api.delete(`/budget-allocations/${id}`);
  }
  listExpectedIncome(): Observable<ExpectedIncome[]> {
    return this.api
      .get<ExpectedIncomeWire[]>('/expected-income')
      .pipe(map((items) => items.map(mapExpectedIncome)));
  }
  upsertExpectedIncome(input: Omit<ExpectedIncome, 'id'>): Observable<ExpectedIncome> {
    return this.api
      .put<ExpectedIncomeWire>('/expected-income', mapExpectedIncomeInput(input))
      .pipe(map(mapExpectedIncome));
  }
}
