import { Observable } from 'rxjs';
import { Category, CategoryKind } from '../domain/models/category';

/**
 * See account.repository.ts for the DI-token pattern this follows.
 *
 * Delete is guarded, not forbidden: a category can be referenced by years
 * of past transactions/budgets, or have child categories under it, and
 * deleting it out from under any of those would orphan that history - so
 * `delete` is only meaningful (and only exposed in the UI) once
 * `domain/calc/category-usage.ts`'s `isCategoryDeletable` confirms nothing
 * references it. Archiving (`setArchived`, not `delete`) remains the way to
 * retire a category that's still in use - it hides the category from
 * "create new transaction" pickers without touching history.
 */
export abstract class CategoryRepository {
  abstract list(): Observable<Category[]>;
  abstract create(input: Omit<Category, 'id' | 'position'>): Observable<Category>;
  abstract update(id: string, changes: Partial<Omit<Category, 'id'>>): Observable<Category>;
  abstract setArchived(id: string, archived: boolean): Observable<Category>;
  /** Only safe to call once `isCategoryDeletable` confirms the category is unused - see class doc. */
  abstract delete(id: string): Observable<void>;
  /** Reassigns sibling order within one `kind`/`parentId` group - see MockStore.reorderCategories. */
  abstract reorder(kind: CategoryKind, parentId: string | undefined, orderedIds: string[]): Observable<void>;
}
