import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { CategoryRepository } from '../category.repository';
import { Category } from '../../domain/models/category';
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

  create(input: Omit<Category, 'id'>): Observable<Category> {
    return mockResult(() => this.store.createCategory(input), this.latencyMs);
  }

  update(id: string, changes: Partial<Omit<Category, 'id'>>): Observable<Category> {
    return mockResult(() => this.store.updateCategory(id, changes), this.latencyMs);
  }

  setArchived(id: string, archived: boolean): Observable<Category> {
    return mockResult(() => this.store.updateCategory(id, { archived }), this.latencyMs);
  }
}
