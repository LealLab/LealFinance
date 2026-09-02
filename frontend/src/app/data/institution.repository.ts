import { Observable } from 'rxjs';
import { Institution } from '../domain/models/institution';

/**
 * See account.repository.ts for the DI-token pattern this follows.
 * Like CategoryGroup, an Institution can be deleted outright, while callers
 * choose how referenced accounts and wallets are handled.
 */
export type InstitutionDeleteMode = 'guard' | 'detach' | 'cascade';

export abstract class InstitutionRepository {
  abstract list(): Observable<Institution[]>;
  abstract get(id: string): Observable<Institution | undefined>;
  abstract create(input: Omit<Institution, 'id'>): Observable<Institution>;
  abstract update(id: string, changes: Partial<Omit<Institution, 'id'>>): Observable<Institution>;
  abstract setArchived(id: string, archived: boolean): Observable<Institution>;
  abstract delete(id: string, mode?: InstitutionDeleteMode): Observable<void>;
}
