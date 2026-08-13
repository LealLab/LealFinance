import { Observable } from 'rxjs';
import { Category } from '../domain/models/category';

/**
 * See account.repository.ts for the DI-token pattern this follows.
 * Categories are archived, never deleted (`setArchived`, not `delete`) —
 * a category can be referenced by years of past transactions, and
 * deleting it out from under them would orphan that history.
 */
export abstract class CategoryRepository {
  abstract list(): Observable<Category[]>;
  abstract create(input: Omit<Category, 'id'>): Observable<Category>;
  abstract update(id: string, changes: Partial<Omit<Category, 'id'>>): Observable<Category>;
  abstract setArchived(id: string, archived: boolean): Observable<Category>;
}
