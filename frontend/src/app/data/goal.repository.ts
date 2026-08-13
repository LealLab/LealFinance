import { Observable } from 'rxjs';
import { Goal } from '../domain/models/goal';

export abstract class GoalRepository {
  abstract list(): Observable<Goal[]>;
  abstract create(input: Omit<Goal, 'id'>): Observable<Goal>;
  abstract update(id: string, changes: Partial<Omit<Goal, 'id'>>): Observable<Goal>;
}
