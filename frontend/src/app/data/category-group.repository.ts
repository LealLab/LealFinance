import { Observable } from 'rxjs';
import { CategoryKind } from '../domain/models/category';
import { CategoryGroup } from '../domain/models/category-group';

/** Repository contract for the user's category groups. */
export abstract class CategoryGroupRepository {
  abstract list(): Observable<CategoryGroup[]>;
  abstract create(input: Omit<CategoryGroup, 'id' | 'position'>): Observable<CategoryGroup>;
  abstract update(id: string, changes: Partial<Omit<CategoryGroup, 'id'>>): Observable<CategoryGroup>;
  abstract delete(id: string): Observable<void>;
  /** Reassigns group order within one kind. */
  abstract reorder(kind: CategoryKind, orderedIds: string[]): Observable<void>;
}
