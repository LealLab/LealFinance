import { Observable } from 'rxjs';
import { Category, CategoryKind } from '../domain/models/category';

/**
 * See account.repository.ts for the DI-token pattern this follows.
 */
export abstract class CategoryRepository {
  abstract list(): Observable<Category[]>;
  abstract create(input: Omit<Category, 'id' | 'position'>): Observable<Category>;
  abstract update(id: string, changes: Partial<Omit<Category, 'id'>>): Observable<Category>;
  abstract delete(id: string): Observable<void>;
  /** Reassigns sibling order within one `kind`/`groupId` group. */
  abstract reorder(kind: CategoryKind, groupId: string, orderedIds: string[]): Observable<void>;
}
