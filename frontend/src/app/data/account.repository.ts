import { Observable } from 'rxjs';
import { Account, AccountBalance } from '../domain/models/account';

/**
 * Abstract class used as the DI token (see app.config.ts) - components
 * inject `AccountRepository`, never a concrete implementation directly, so
 * the application can select the HTTP provider while tests can select the
 * in-memory provider without changing call sites. Every method returns an
 * Observable so both implementations share the same contract.
 */
export abstract class AccountRepository {
  abstract list(): Observable<Account[]>;
  /** Server-computed balance for every owned account - see AccountBalance. */
  abstract balances(): Observable<AccountBalance[]>;
  abstract get(id: string): Observable<Account | undefined>;
  abstract create(input: Omit<Account, 'id'>): Observable<Account>;
  abstract update(id: string, changes: Partial<Omit<Account, 'id'>>): Observable<Account>;
  abstract setArchived(id: string, archived: boolean): Observable<Account>;
}
