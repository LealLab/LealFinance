import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { ApiClient } from '../../core/api-client';
import {
  CategorizationRule,
  RuleExportItem,
  RulePack,
} from '../../domain/models/categorization-rule';
import { CategorizationRuleRepository } from '../categorization-rule.repository';
import {
  mapCategorizationRule,
  mapCategorizationRuleCreate,
  mapCategorizationRulePatch,
  mapRuleImportItem,
  mapRulePack,
} from './mappers';
import {
  CategorizationRuleWire,
  RuleImportResultWire,
  RulePackInstallResultWire,
  RulePackWire,
} from './wire-dtos';

@Injectable({ providedIn: 'root' })
export class HttpCategorizationRuleRepository extends CategorizationRuleRepository {
  private readonly api = inject(ApiClient);

  list(): Observable<CategorizationRule[]> {
    return this.api
      .get<CategorizationRuleWire[]>('/categorization-rules')
      .pipe(map((items) => items.map(mapCategorizationRule)));
  }

  create(input: Omit<CategorizationRule, 'id'>): Observable<CategorizationRule> {
    return this.api
      .post<CategorizationRuleWire>('/categorization-rules', mapCategorizationRuleCreate(input))
      .pipe(map(mapCategorizationRule));
  }

  update(
    id: string,
    changes: Partial<Omit<CategorizationRule, 'id'>>,
  ): Observable<CategorizationRule> {
    return this.api
      .patch<CategorizationRuleWire>(
        `/categorization-rules/${id}`,
        mapCategorizationRulePatch(changes),
      )
      .pipe(map(mapCategorizationRule));
  }

  delete(id: string): Observable<void> {
    return this.api.delete(`/categorization-rules/${id}`);
  }

  importRules(
    rules: RuleExportItem[],
    replace: boolean,
  ): Observable<{ imported: number; skipped: number }> {
    return this.api
      .post<RuleImportResultWire>('/categorization-rules/import', {
        rules: rules.map(mapRuleImportItem),
        replace,
      })
      .pipe(map((result) => ({ imported: result.imported, skipped: result.skipped })));
  }

  reapply(overwrite: boolean): Observable<number> {
    return this.api
      .post<{ updated: number }>('/categorization-rules/reapply', { overwrite })
      .pipe(map((result) => result.updated));
  }

  listPacks(): Observable<RulePack[]> {
    return this.api
      .get<RulePackWire[]>('/categorization-rules/packs')
      .pipe(map((items) => items.map(mapRulePack)));
  }

  installPack(code: string): Observable<{ installed: number; skipped: number }> {
    return this.api
      .post<RulePackInstallResultWire>(`/categorization-rules/packs/${code}/install`, {})
      .pipe(map((result) => ({ installed: result.installed, skipped: result.skipped })));
  }
}
