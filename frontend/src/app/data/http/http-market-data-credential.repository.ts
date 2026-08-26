import { Injectable, inject } from '@angular/core';
import { map, Observable } from 'rxjs';
import { ApiClient } from '../../core/api-client';
import {
  MarketDataCredentialStatus,
  MarketDataProvider,
} from '../../domain/models/market-data-credential';
import { MarketDataCredentialRepository } from '../market-data-credential.repository';
import { mapMarketDataCredentialStatus } from './mappers';
import { MarketDataCredentialStatusWire } from './wire-dtos';

@Injectable({ providedIn: 'root' })
export class HttpMarketDataCredentialRepository extends MarketDataCredentialRepository {
  private readonly api = inject(ApiClient);

  list(): Observable<MarketDataCredentialStatus[]> {
    return this.api
      .get<MarketDataCredentialStatusWire[]>('/market-data/credentials')
      .pipe(map((rows) => rows.map(mapMarketDataCredentialStatus)));
  }

  link(
    provider: MarketDataProvider,
    apiKey: string,
  ): Observable<MarketDataCredentialStatus> {
    return this.api
      .put<MarketDataCredentialStatusWire>(`/market-data/credentials/${provider}`, {
        api_key: apiKey,
      })
      .pipe(map(mapMarketDataCredentialStatus));
  }

  unlink(provider: MarketDataProvider): Observable<void> {
    return this.api.delete(`/market-data/credentials/${provider}`);
  }
}
