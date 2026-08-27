import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { CategoryKind } from '../../domain/models/category';
import { CategoryGroup } from '../../domain/models/category-group';
import { CategoryGroupRepository } from '../category-group.repository';
import { MOCK_LATENCY_MS } from './mock-latency';
import { mockResult } from './mock-result';
import { MockStore } from './mock-store';

@Injectable({ providedIn: 'root' })
export class MockCategoryGroupRepository extends CategoryGroupRepository {
  private readonly store = inject(MockStore);
  private readonly latencyMs = inject(MOCK_LATENCY_MS);

  list(): Observable<CategoryGroup[]> {
    return mockResult(() => this.store.categoryGroups(), this.latencyMs);
  }

  create(input: Omit<CategoryGroup, 'id' | 'position'>): Observable<CategoryGroup> {
    return mockResult(() => this.store.createCategoryGroup(input), this.latencyMs);
  }

  update(id: string, changes: Partial<Omit<CategoryGroup, 'id'>>): Observable<CategoryGroup> {
    return mockResult(() => this.store.updateCategoryGroup(id, changes), this.latencyMs);
  }

  delete(id: string): Observable<void> {
    return mockResult(() => this.store.deleteCategoryGroup(id), this.latencyMs);
  }

  reorder(kind: CategoryKind, orderedIds: string[]): Observable<void> {
    return mockResult(() => this.store.reorderCategoryGroups(kind, orderedIds), this.latencyMs);
  }
}
