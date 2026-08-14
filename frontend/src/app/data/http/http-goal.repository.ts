import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { ApiClient } from '../../core/api-client';
import { Goal } from '../../domain/models/goal';
import { GoalCreate, GoalRepository, GoalUpdate } from '../goal.repository';
import { mapGoal, mapGoalCreate, mapGoalPatch } from './mappers';
import { GoalWire, GoalWithAccountWire } from './wire-dtos';

@Injectable({ providedIn: 'root' })
export class HttpGoalRepository extends GoalRepository {
  private readonly api = inject(ApiClient);
  list(): Observable<Goal[]> {
    return this.api.get<GoalWire[]>('/goals').pipe(map((items) => items.map(mapGoal)));
  }
  create(input: GoalCreate): Observable<Goal> {
    return this.api
      .post<GoalWithAccountWire>('/goals/with-account', mapGoalCreate(input))
      .pipe(map((result) => mapGoal(result.goal)));
  }
  update(id: string, changes: GoalUpdate): Observable<Goal> {
    return this.api
      .patch<GoalWithAccountWire>(`/goals/${id}/with-account`, mapGoalPatch(changes))
      .pipe(map((result) => mapGoal(result.goal)));
  }
  setArchived(id: string, archived: boolean): Observable<Goal> {
    return this.api
      .post<GoalWithAccountWire>(`/goals/${id}/archive`, { archived })
      .pipe(map((result) => mapGoal(result.goal)));
  }
}
