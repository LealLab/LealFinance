import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { ApiClient } from '../../core/api-client';
import { Budget } from '../../domain/models/budget';
import { BudgetRepository } from '../budget.repository';
import { mapBudget, mapBudgetInput } from './mappers';
import { BudgetWire } from './wire-dtos';

@Injectable({ providedIn: 'root' })
export class HttpBudgetRepository extends BudgetRepository {
  private readonly api = inject(ApiClient);
  list(): Observable<Budget[]> {
    return this.api.get<BudgetWire[]>('/budgets').pipe(map((items) => items.map(mapBudget)));
  }
  upsert(input: Omit<Budget, 'id'>): Observable<Budget> {
    return this.api.put<BudgetWire>('/budgets', mapBudgetInput(input)).pipe(map(mapBudget));
  }
  delete(id: string): Observable<void> {
    return this.api.delete(`/budgets/${id}`);
  }
}
