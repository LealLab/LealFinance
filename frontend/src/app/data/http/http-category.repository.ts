import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { ApiClient } from '../../core/api-client';
import { Category, CategoryKind } from '../../domain/models/category';
import { CategoryRepository } from '../category.repository';
import { mapCategory, mapCategoryCreate, mapCategoryPatch } from './mappers';
import { CategoryWire } from './wire-dtos';

@Injectable({ providedIn: 'root' })
export class HttpCategoryRepository extends CategoryRepository {
  private readonly api = inject(ApiClient);
  list(): Observable<Category[]> {
    return this.api.get<CategoryWire[]>('/categories').pipe(map((items) => items.map(mapCategory)));
  }
  create(input: Omit<Category, 'id' | 'position'>): Observable<Category> {
    return this.api
      .post<CategoryWire>('/categories', mapCategoryCreate(input))
      .pipe(map(mapCategory));
  }
  update(id: string, changes: Partial<Omit<Category, 'id'>>): Observable<Category> {
    return this.api
      .patch<CategoryWire>(`/categories/${id}`, mapCategoryPatch(changes))
      .pipe(map(mapCategory));
  }
  setArchived(id: string, archived: boolean): Observable<Category> {
    return this.api
      .post<CategoryWire>(`/categories/${id}/archive`, { archived })
      .pipe(map(mapCategory));
  }
  delete(id: string): Observable<void> {
    return this.api.delete(`/categories/${id}`);
  }
  reorder(
    kind: CategoryKind,
    parentId: string | undefined,
    orderedIds: string[],
  ): Observable<void> {
    return this.api.post<void>('/categories/reorder', {
      kind,
      parent_id: parentId ?? null,
      ordered_ids: orderedIds,
    });
  }
}
