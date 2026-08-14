import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ManualRateRepository } from '../manual-rate.repository';
import { ManualRate } from '../../domain/models/manual-rate';
import { MOCK_LATENCY_MS } from './mock-latency';
import { mockResult } from './mock-result';
import { MockStore } from './mock-store';

@Injectable({ providedIn: 'root' })
export class MockManualRateRepository extends ManualRateRepository {
  private readonly store = inject(MockStore);
  private readonly latencyMs = inject(MOCK_LATENCY_MS);

  list(): Observable<ManualRate[]> {
    return mockResult(() => this.store.manualRates(), this.latencyMs);
  }

  upsert(input: Omit<ManualRate, 'id'>): Observable<ManualRate> {
    return mockResult(() => this.store.upsertManualRate(input), this.latencyMs);
  }

  delete(id: string): Observable<void> {
    return mockResult(() => this.store.deleteManualRate(id), this.latencyMs);
  }
}
