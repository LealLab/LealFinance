import { Observable } from 'rxjs';
import { Institution } from '../domain/models/institution';

/**
 * See account.repository.ts for the DI-token pattern this follows.
 * Unlike Category (archived, never deleted - see category.repository.ts),
 * an Institution can be deleted outright, but only once no Account
 * references it anymore; see MockStore.deleteInstitution for that guard.
 */
export abstract class InstitutionRepository {
  abstract list(): Observable<Institution[]>;
  abstract get(id: string): Observable<Institution | undefined>;
  abstract create(input: Omit<Institution, 'id'>): Observable<Institution>;
  abstract update(id: string, changes: Partial<Omit<Institution, 'id'>>): Observable<Institution>;
  abstract setArchived(id: string, archived: boolean): Observable<Institution>;
  abstract delete(id: string): Observable<void>;
}
