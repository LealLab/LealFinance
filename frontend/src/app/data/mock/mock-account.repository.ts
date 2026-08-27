import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { AccountRepository } from '../account.repository';
import { Account, AccountBalance } from '../../domain/models/account';
import { accountBalance } from '../../domain/calc/balances';
import { MOCK_LATENCY_MS } from './mock-latency';
import { mockResult } from './mock-result';
import { MockStore } from './mock-store';

@Injectable({ providedIn: 'root' })
export class MockAccountRepository extends AccountRepository {
  private readonly store = inject(MockStore);
  private readonly latencyMs = inject(MOCK_LATENCY_MS);

  list(): Observable<Account[]> {
    return mockResult(() => this.store.accounts(), this.latencyMs);
  }

  balances(asOf?: string): Observable<AccountBalance[]> {
    return mockResult(() => {
      const transactions = asOf
        ? this.store.transactions().filter((transaction) => transaction.date <= asOf)
        : this.store.transactions();
      return this.store.accounts().map((account) => ({
        accountId: account.id,
        currency: account.currency,
        balance: accountBalance(account, transactions).amount,
      }));
    }, this.latencyMs);
  }

  get(id: string): Observable<Account | undefined> {
    return mockResult(() => this.store.accounts().find((account) => account.id === id), this.latencyMs);
  }

  create(input: Omit<Account, 'id'>): Observable<Account> {
    return mockResult(() => this.store.createAccount(input), this.latencyMs);
  }

  update(id: string, changes: Partial<Omit<Account, 'id'>>): Observable<Account> {
    return mockResult(() => this.store.updateAccount(id, changes), this.latencyMs);
  }

  setArchived(id: string, archived: boolean): Observable<Account> {
    return mockResult(() => this.store.updateAccount(id, { archived }), this.latencyMs);
  }
}
