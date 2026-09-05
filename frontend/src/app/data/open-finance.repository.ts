import { Observable } from 'rxjs';
import {
  PluggyAccount,
  PluggyConnectToken,
  PluggyCredentialStatus,
  PluggyEnvironment,
  PluggyItem,
  PluggySyncResult,
} from '../domain/models/open-finance';

export type OpenFinanceDisconnectMode = 'keep' | 'delete';

export abstract class OpenFinanceRepository {
  abstract getCredentialStatus(): Observable<PluggyCredentialStatus>;
  abstract linkCredentials(
    clientId: string,
    clientSecret: string,
    environment: PluggyEnvironment,
  ): Observable<PluggyCredentialStatus>;
  abstract unlinkCredentials(): Observable<void>;
  abstract createConnectToken(itemId?: string): Observable<PluggyConnectToken>;
  abstract listItems(): Observable<PluggyItem[]>;
  abstract registerItem(externalId: string): Observable<PluggyItem>;
  abstract getItemAccounts(itemId: string): Observable<PluggyAccount[]>;
  abstract disconnectItem(itemId: string, mode: OpenFinanceDisconnectMode): Observable<void>;
  abstract syncItem(itemId: string): Observable<PluggySyncResult>;
}
