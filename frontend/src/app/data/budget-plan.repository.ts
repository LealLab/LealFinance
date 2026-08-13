import { Observable } from 'rxjs';
import { BudgetAllocation, ExpectedIncome } from '../domain/models/budget-plan';

export abstract class BudgetPlanRepository {
  abstract listAllocations(): Observable<BudgetAllocation[]>;
  abstract upsertAllocation(input: Omit<BudgetAllocation, 'id'>): Observable<BudgetAllocation>;
  abstract deleteAllocation(id: string): Observable<void>;
  abstract listExpectedIncome(): Observable<ExpectedIncome[]>;
  abstract upsertExpectedIncome(input: Omit<ExpectedIncome, 'id'>): Observable<ExpectedIncome>;
}
