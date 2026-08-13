import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { RecurringRuleRepository } from '../recurring-rule.repository';
import { RecurringRule } from '../../domain/models/recurring';
import { MOCK_LATENCY_MS } from './mock-latency';
import { mockResult } from './mock-result';
import { MockStore } from './mock-store';

@Injectable({ providedIn: 'root' })
export class MockRecurringRuleRepository extends RecurringRuleRepository {
  private readonly store = inject(MockStore);
  private readonly latencyMs = inject(MOCK_LATENCY_MS);

  list(): Observable<RecurringRule[]> {
    return mockResult(() => this.store.recurringRules(), this.latencyMs);
  }

  create(input: Omit<RecurringRule, 'id'>): Observable<RecurringRule> {
    return mockResult(() => this.store.createRecurringRule(input), this.latencyMs);
  }

  update(id: string, changes: Partial<Omit<RecurringRule, 'id'>>): Observable<RecurringRule> {
    return mockResult(() => this.store.updateRecurringRule(id, changes), this.latencyMs);
  }

  delete(id: string): Observable<void> {
    return mockResult(() => this.store.deleteRecurringRule(id), this.latencyMs);
  }
}
