import { Injectable, inject } from '@angular/core';
import { map, Observable } from 'rxjs';
import { ApiClient } from '../../core/api-client';
import {
  PluggyAccount,
  PluggyConnectToken,
  PluggyCredentialStatus,
  PluggyEnvironment,
  PluggyItem,
  PluggySyncResult,
} from '../../domain/models/open-finance';
import {
  OpenFinanceDisconnectMode,
  OpenFinanceRepository,
} from '../open-finance.repository';
import {
  mapConnectToken,
  mapPluggyAccount,
  mapPluggyCredentialStatus,
  mapPluggyItem,
  mapPluggySyncResult,
} from './mappers';
import {
  ConnectTokenRequestWire,
  ConnectTokenWire,
  PluggyAccountWire,
  PluggyCredentialWriteWire,
  PluggyCredentialStatusWire,
  PluggyItemCreateWire,
  PluggyItemWire,
  PluggySyncResultWire,
} from './wire-dtos';

@Injectable({ providedIn: 'root' })
export class HttpOpenFinanceRepository extends OpenFinanceRepository {
  private readonly api = inject(ApiClient);

  getCredentialStatus(): Observable<PluggyCredentialStatus> {
    return this.api
      .get<PluggyCredentialStatusWire>('/open-finance/credentials')
      .pipe(map(mapPluggyCredentialStatus));
  }

  linkCredentials(
    clientId: string,
    clientSecret: string,
    environment: PluggyEnvironment,
  ): Observable<PluggyCredentialStatus> {
    const body: PluggyCredentialWriteWire = {
      client_id: clientId,
      client_secret: clientSecret,
      environment,
    };
    return this.api
      .put<PluggyCredentialStatusWire>('/open-finance/credentials', body)
      .pipe(map(mapPluggyCredentialStatus));
  }

  unlinkCredentials(): Observable<void> {
    return this.api.delete('/open-finance/credentials');
  }

  createConnectToken(itemId?: string): Observable<PluggyConnectToken> {
    const body: ConnectTokenRequestWire | undefined = itemId ? { item_id: itemId } : undefined;
    return this.api
      .post<ConnectTokenWire>('/open-finance/connect-token', body)
      .pipe(map(mapConnectToken));
  }

  listItems(): Observable<PluggyItem[]> {
    return this.api
      .get<PluggyItemWire[]>('/open-finance/items')
      .pipe(map((items) => items.map(mapPluggyItem)));
  }

  registerItem(externalId: string): Observable<PluggyItem> {
    const body: PluggyItemCreateWire = { external_id: externalId };
    return this.api
      .post<PluggyItemWire>('/open-finance/items', body)
      .pipe(map(mapPluggyItem));
  }

  getItemAccounts(itemId: string): Observable<PluggyAccount[]> {
    return this.api
      .get<PluggyAccountWire[]>(`/open-finance/items/${itemId}/accounts`)
      .pipe(map((accounts) => accounts.map(mapPluggyAccount)));
  }

  disconnectItem(itemId: string, mode: OpenFinanceDisconnectMode): Observable<void> {
    return this.api.delete(`/open-finance/items/${itemId}`, { mode });
  }

  syncItem(itemId: string): Observable<PluggySyncResult> {
    return this.api
      .post<PluggySyncResultWire>(`/open-finance/items/${itemId}/sync`)
      .pipe(map(mapPluggySyncResult));
  }
}
