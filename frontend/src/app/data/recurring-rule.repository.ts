import { Observable } from 'rxjs';
import { RecurringRule } from '../domain/models/recurring';

/** See account.repository.ts for the DI-token pattern this follows. */
export abstract class RecurringRuleRepository {
  abstract list(): Observable<RecurringRule[]>;
  abstract create(input: Omit<RecurringRule, 'id'>): Observable<RecurringRule>;
  abstract update(id: string, changes: Partial<Omit<RecurringRule, 'id'>>): Observable<RecurringRule>;
  abstract delete(id: string): Observable<void>;
}
