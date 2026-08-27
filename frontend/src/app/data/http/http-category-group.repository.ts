import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { ApiClient } from '../../core/api-client';
import { CategoryKind } from '../../domain/models/category';
import { CategoryGroup } from '../../domain/models/category-group';
import { CategoryGroupRepository } from '../category-group.repository';
import { mapCategoryGroup, mapCategoryGroupCreate, mapCategoryGroupPatch } from './mappers';
import { CategoryGroupWire } from './wire-dtos';

@Injectable({ providedIn: 'root' })
export class HttpCategoryGroupRepository extends CategoryGroupRepository {
  private readonly api = inject(ApiClient);

  list(): Observable<CategoryGroup[]> {
    return this.api
      .get<CategoryGroupWire[]>('/category-groups')
      .pipe(map((items) => items.map(mapCategoryGroup)));
  }

  create(input: Omit<CategoryGroup, 'id' | 'position'>): Observable<CategoryGroup> {
    return this.api
      .post<CategoryGroupWire>('/category-groups', mapCategoryGroupCreate(input))
      .pipe(map(mapCategoryGroup));
  }

  update(id: string, changes: Partial<Omit<CategoryGroup, 'id'>>): Observable<CategoryGroup> {
    return this.api
      .patch<CategoryGroupWire>(`/category-groups/${id}`, mapCategoryGroupPatch(changes))
      .pipe(map(mapCategoryGroup));
  }

  delete(id: string): Observable<void> {
    return this.api.delete(`/category-groups/${id}`);
  }

  reorder(kind: CategoryKind, orderedIds: string[]): Observable<void> {
    return this.api.post<void>('/category-groups/reorder', { kind, ordered_ids: orderedIds });
  }
}
