import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { ApiClient } from '../../core/api-client';
import { RecurringRule } from '../../domain/models/recurring';
import { RecurringRuleRepository } from '../recurring-rule.repository';
import { mapRecurringRule, mapRecurringRuleCreate, mapRecurringRulePatch } from './mappers';
import { RecurringRuleWire } from './wire-dtos';

@Injectable({ providedIn: 'root' })
export class HttpRecurringRuleRepository extends RecurringRuleRepository {
  private readonly api = inject(ApiClient);
  list(): Observable<RecurringRule[]> {
    return this.api
      .get<RecurringRuleWire[]>('/recurring-rules')
      .pipe(map((items) => items.map(mapRecurringRule)));
  }
  create(input: Omit<RecurringRule, 'id'>): Observable<RecurringRule> {
    return this.api
      .post<RecurringRuleWire>('/recurring-rules', mapRecurringRuleCreate(input))
      .pipe(map(mapRecurringRule));
  }
  update(id: string, changes: Partial<Omit<RecurringRule, 'id'>>): Observable<RecurringRule> {
    return this.api
      .patch<RecurringRuleWire>(`/recurring-rules/${id}`, mapRecurringRulePatch(changes))
      .pipe(map(mapRecurringRule));
  }
  delete(id: string): Observable<void> {
    return this.api.delete(`/recurring-rules/${id}`);
  }
}
