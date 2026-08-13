import { Observable } from 'rxjs';
import { Budget } from '../domain/models/budget';

/**
 * See account.repository.ts for the DI-token pattern this follows.
 * `upsert` rather than separate create/update: the budgets screen sets
 * "the amount for this category this month," and the caller shouldn't
 * need to know whether that Budget row already exists.
 */
export abstract class BudgetRepository {
  abstract list(): Observable<Budget[]>;
  abstract upsert(input: Omit<Budget, 'id'>): Observable<Budget>;
  abstract delete(id: string): Observable<void>;
}
