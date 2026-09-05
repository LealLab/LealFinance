import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
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
import { MOCK_LATENCY_MS } from './mock-latency';
import { mockResult } from './mock-result';
import { MockStore } from './mock-store';

@Injectable({ providedIn: 'root' })
export class MockOpenFinanceRepository extends OpenFinanceRepository {
  private readonly store = inject(MockStore);
  private readonly latencyMs = inject(MOCK_LATENCY_MS);

  getCredentialStatus(): Observable<PluggyCredentialStatus> {
    return mockResult(() => this.store.openFinanceCredentialStatus(), this.latencyMs);
  }

  linkCredentials(
    clientId: string,
    clientSecret: string,
    environment: PluggyEnvironment,
  ): Observable<PluggyCredentialStatus> {
    void clientId;
    void clientSecret;
    return mockResult(() => this.store.linkOpenFinanceCredentials(environment), this.latencyMs);
  }

  unlinkCredentials(): Observable<void> {
    return mockResult(() => this.store.unlinkOpenFinanceCredentials(), this.latencyMs);
  }

  createConnectToken(itemId?: string): Observable<PluggyConnectToken> {
    return mockResult(() => this.store.createOpenFinanceConnectToken(itemId), this.latencyMs);
  }

  listItems(): Observable<PluggyItem[]> {
    return mockResult(() => this.store.openFinanceItems(), this.latencyMs);
  }

  registerItem(externalId: string): Observable<PluggyItem> {
    return mockResult(() => this.store.registerOpenFinanceItem(externalId), this.latencyMs);
  }

  getItemAccounts(itemId: string): Observable<PluggyAccount[]> {
    return mockResult(() => this.store.openFinanceAccounts(itemId), this.latencyMs);
  }

  disconnectItem(itemId: string, mode: OpenFinanceDisconnectMode): Observable<void> {
    return mockResult(() => this.store.disconnectOpenFinanceItem(itemId, mode), this.latencyMs);
  }

  syncItem(itemId: string): Observable<PluggySyncResult> {
    return mockResult(() => this.store.syncOpenFinanceItem(itemId), this.latencyMs);
  }
}
