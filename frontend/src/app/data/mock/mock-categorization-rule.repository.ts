import { inject, Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { CategorizationRule, RuleExportItem, RulePack } from '../../domain/models/categorization-rule';
import { CategorizationRuleRepository } from '../categorization-rule.repository';
import { MOCK_LATENCY_MS } from './mock-latency';
import { mockResult } from './mock-result';
import { MockStore } from './mock-store';

@Injectable({ providedIn: 'root' })
export class MockCategorizationRuleRepository extends CategorizationRuleRepository {
  private readonly store = inject(MockStore);
  private readonly latencyMs = inject(MOCK_LATENCY_MS);

  list(): Observable<CategorizationRule[]> {
    return mockResult(() => this.store.categorizationRules(), this.latencyMs);
  }

  create(input: Omit<CategorizationRule, 'id'>): Observable<CategorizationRule> {
    return mockResult(() => this.store.createCategorizationRule(input), this.latencyMs);
  }

  update(
    id: string,
    changes: Partial<Omit<CategorizationRule, 'id'>>,
  ): Observable<CategorizationRule> {
    return mockResult(() => this.store.updateCategorizationRule(id, changes), this.latencyMs);
  }

  delete(id: string): Observable<void> {
    return mockResult(() => this.store.deleteCategorizationRule(id), this.latencyMs);
  }

  importRules(
    rules: RuleExportItem[],
    replace: boolean,
  ): Observable<{ imported: number; skipped: number }> {
    void replace;
    return mockResult(() => {
      rules.forEach((rule) =>
        this.store.createCategorizationRule({
          name: rule.name,
          priority: rule.priority,
          isActive: rule.isActive,
          matchOp: rule.matchOp,
          conditions: rule.conditions,
          categoryId: rule.category,
        }),
      );
      return { imported: rules.length, skipped: 0 };
    }, this.latencyMs);
  }

  reapply(overwrite: boolean): Observable<number> {
    void overwrite;
    return of(0);
  }

  listPacks(): Observable<RulePack[]> {
    return of([]);
  }

  installPack(code: string): Observable<{ installed: number; skipped: number }> {
    void code;
    return of({ installed: 0, skipped: 0 });
  }
}
