import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { GoalCreate, GoalRepository, GoalUpdate } from '../goal.repository';
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

  create(input: GoalCreate): Observable<Goal> {
    return mockResult(() => {
      const account = this.store.createAccount({
        name: input.name,
        type: 'goal',
        currency: input.currency,
        openingBalance: '0',
        archived: input.archived,
      });
      return this.store.createGoal({ ...input, accountId: account.id });
    }, this.latencyMs);
  }

  update(id: string, changes: GoalUpdate): Observable<Goal> {
    return mockResult(() => {
      const goal = this.store.updateGoal(id, changes);
      this.store.updateAccount(goal.accountId, {
        ...(Object.prototype.hasOwnProperty.call(changes, 'name') ? { name: changes.name } : {}),
        ...(Object.prototype.hasOwnProperty.call(changes, 'currency')
          ? { currency: changes.currency }
          : {}),
      });
      return goal;
    }, this.latencyMs);
  }

  setArchived(id: string, archived: boolean): Observable<Goal> {
    return mockResult(() => {
      const goal = this.store.updateGoal(id, { archived });
      this.store.updateAccount(goal.accountId, { archived });
      return goal;
    }, this.latencyMs);
  }
}
