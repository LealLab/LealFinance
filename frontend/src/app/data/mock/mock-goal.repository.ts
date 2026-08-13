import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { GoalRepository } from '../goal.repository';
import { Goal } from '../../domain/models/goal';
import { MOCK_LATENCY_MS } from './mock-latency';
import { mockResult } from './mock-result';
import { MockStore } from './mock-store';

@Injectable({ providedIn: 'root' })
export class MockGoalRepository extends GoalRepository {
  private readonly store = inject(MockStore);
  private readonly latencyMs = inject(MOCK_LATENCY_MS);

  list(): Observable<Goal[]> {
    return mockResult(() => this.store.goals(), this.latencyMs);
  }

  create(input: Omit<Goal, 'id'>): Observable<Goal> {
    return mockResult(() => this.store.createGoal(input), this.latencyMs);
  }

  update(id: string, changes: Partial<Omit<Goal, 'id'>>): Observable<Goal> {
    return mockResult(() => this.store.updateGoal(id, changes), this.latencyMs);
  }
}
