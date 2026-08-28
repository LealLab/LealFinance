import { Observable } from 'rxjs';
import {
  CategorizationRule,
  RuleExportItem,
  RulePack,
} from '../domain/models/categorization-rule';

/** See account.repository.ts for the DI-token pattern this follows. */
export abstract class CategorizationRuleRepository {
  abstract list(): Observable<CategorizationRule[]>;
  abstract create(input: Omit<CategorizationRule, 'id'>): Observable<CategorizationRule>;
  abstract update(
    id: string,
    changes: Partial<Omit<CategorizationRule, 'id'>>,
  ): Observable<CategorizationRule>;
  abstract delete(id: string): Observable<void>;
  /** POST /categorization-rules/import - returns {imported, skipped}. */
  abstract importRules(
    rules: RuleExportItem[],
    replace: boolean,
  ): Observable<{ imported: number; skipped: number }>;
  /** POST /categorization-rules/reapply - returns number of transactions updated. */
  abstract reapply(overwrite: boolean): Observable<number>;
  /** GET /categorization-rules/packs */
  abstract listPacks(): Observable<RulePack[]>;
  /** POST /categorization-rules/packs/{code}/install - returns {installed, skipped}. */
  abstract installPack(code: string): Observable<{ installed: number; skipped: number }>;
}
