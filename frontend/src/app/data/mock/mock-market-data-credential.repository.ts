import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { MarketDataCredentialRepository } from '../market-data-credential.repository';
import {
  MarketDataCredentialStatus,
  MarketDataProvider,
} from '../../domain/models/market-data-credential';
import { MOCK_LATENCY_MS } from './mock-latency';
import { mockResult } from './mock-result';
import { MockStore } from './mock-store';

@Injectable({ providedIn: 'root' })
export class MockMarketDataCredentialRepository extends MarketDataCredentialRepository {
  private readonly store = inject(MockStore);
  private readonly latencyMs = inject(MOCK_LATENCY_MS);

  list(): Observable<MarketDataCredentialStatus[]> {
    return mockResult(() => this.store.marketDataCredentialStatuses(), this.latencyMs);
  }

  link(
    provider: MarketDataProvider,
    apiKey: string,
  ): Observable<MarketDataCredentialStatus> {
    void apiKey;
    return mockResult(() => this.store.linkMarketDataProvider(provider), this.latencyMs);
  }

  unlink(provider: MarketDataProvider): Observable<void> {
    return mockResult(() => this.store.unlinkMarketDataProvider(provider), this.latencyMs);
  }
}
