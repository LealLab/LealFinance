import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { InstitutionDeleteMode, InstitutionRepository } from '../institution.repository';
import { Institution } from '../../domain/models/institution';
import { MOCK_LATENCY_MS } from './mock-latency';
import { mockResult } from './mock-result';
import { MockStore } from './mock-store';

@Injectable({ providedIn: 'root' })
export class MockInstitutionRepository extends InstitutionRepository {
  private readonly store = inject(MockStore);
  private readonly latencyMs = inject(MOCK_LATENCY_MS);

  list(): Observable<Institution[]> {
    return mockResult(() => this.store.institutions(), this.latencyMs);
  }

  get(id: string): Observable<Institution | undefined> {
    return mockResult(
      () => this.store.institutions().find((institution) => institution.id === id),
      this.latencyMs
    );
  }

  create(input: Omit<Institution, 'id'>): Observable<Institution> {
    return mockResult(() => this.store.createInstitution(input), this.latencyMs);
  }

  update(id: string, changes: Partial<Omit<Institution, 'id'>>): Observable<Institution> {
    return mockResult(() => this.store.updateInstitution(id, changes), this.latencyMs);
  }

  setArchived(id: string, archived: boolean): Observable<Institution> {
    return mockResult(() => this.store.updateInstitution(id, { archived }), this.latencyMs);
  }

  delete(id: string, mode: InstitutionDeleteMode = 'guard'): Observable<void> {
    return mockResult(() => this.store.deleteInstitution(id, mode), this.latencyMs);
  }
}
