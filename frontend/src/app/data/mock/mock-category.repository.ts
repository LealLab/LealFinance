import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { CategoryRepository } from '../category.repository';
import { Category, CategoryKind } from '../../domain/models/category';
import { MOCK_LATENCY_MS } from './mock-latency';
import { mockResult } from './mock-result';
import { MockStore } from './mock-store';

@Injectable({ providedIn: 'root' })
export class MockCategoryRepository extends CategoryRepository {
  private readonly store = inject(MockStore);
  private readonly latencyMs = inject(MOCK_LATENCY_MS);

  list(): Observable<Category[]> {
    return mockResult(() => this.store.categories(), this.latencyMs);
  }

  create(input: Omit<Category, 'id' | 'position'>): Observable<Category> {
    return mockResult(() => this.store.createCategory(input), this.latencyMs);
  }

  update(id: string, changes: Partial<Omit<Category, 'id'>>): Observable<Category> {
    return mockResult(() => this.store.updateCategory(id, changes), this.latencyMs);
  }

  delete(id: string): Observable<void> {
    return mockResult(() => this.store.deleteCategory(id), this.latencyMs);
  }

  reorder(kind: CategoryKind, groupId: string, orderedIds: string[]): Observable<void> {
    return mockResult(() => this.store.reorderCategories(kind, groupId, orderedIds), this.latencyMs);
  }
}
