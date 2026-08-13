import { Observable } from 'rxjs';
import { Account } from '../domain/models/account';

/**
 * Abstract class used as the DI token (see app.config.ts) — components
 * inject `AccountRepository`, never the mock implementation directly, so
 * swapping in a real HTTP-backed repository later is a provider change,
 * not a call-site change. Every method returns an Observable to match
 * that eventual HTTP shape even though the mock resolves synchronously
 * underneath (with simulated latency — see data/mock/mock-store.ts).
 */
export abstract class AccountRepository {
  abstract list(): Observable<Account[]>;
  abstract get(id: string): Observable<Account | undefined>;
  abstract create(input: Omit<Account, 'id'>): Observable<Account>;
  abstract update(id: string, changes: Partial<Omit<Account, 'id'>>): Observable<Account>;
  abstract setArchived(id: string, archived: boolean): Observable<Account>;
}
