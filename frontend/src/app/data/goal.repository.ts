import { Observable } from 'rxjs';
import { Goal } from '../domain/models/goal';

export type GoalCreate = Omit<Goal, 'id' | 'accountId'>;
export type GoalUpdate = Partial<Omit<Goal, 'id' | 'accountId' | 'archived'>>;

export abstract class GoalRepository {
  abstract list(): Observable<Goal[]>;
  abstract create(input: GoalCreate): Observable<Goal>;
  abstract update(id: string, changes: GoalUpdate): Observable<Goal>;
  abstract setArchived(id: string, archived: boolean): Observable<Goal>;
}
