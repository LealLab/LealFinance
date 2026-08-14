import { Observable } from 'rxjs';
import { ManualRate } from '../domain/models/manual-rate';

/**
 * See account.repository.ts for the DI-token pattern this follows.
 * `upsert` rather than separate create/update, matching budget.repository.ts:
 * a manual rate is keyed by (baseCode, quoteCode, asOf), so the caller
 * shouldn't need to know whether that pair/date already has a row.
 */
export abstract class ManualRateRepository {
  abstract list(): Observable<ManualRate[]>;
  abstract upsert(input: Omit<ManualRate, 'id'>): Observable<ManualRate>;
  abstract delete(id: string): Observable<void>;
}
