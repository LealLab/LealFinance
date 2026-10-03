import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { AccountRepository } from '../account.repository';
import { Account, AccountBalance } from '../../domain/models/account';
import { accountBalance } from '../../domain/calc/balances';
import { add, money } from '../../shared/money/money';
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
      return this.store.accounts().map((account) => {
        const wallet = this.store.investmentWallets().find((item) => item.accountId === account.id);
        const buys = this.store.investmentTransactions().filter((buy) =>
          buy.existingPosition && buy.walletId === wallet?.id && (!asOf || buy.date <= asOf),
        );
        const balance = buys.reduce(
          (total, buy) => add(total, add(money(buy.amount, buy.currency), money(buy.fee, buy.currency))),
          accountBalance(account, transactions),
        );
        return { accountId: account.id, currency: account.currency, balance: balance.amount };
      });
    }, this.latencyMs);
  }

  override realBalances(): Observable<AccountBalance[]> {
    // The mock store has no invoice projector; keep the test double usable
    // while the HTTP repository remains the production source of truth.
    return this.balances();
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

  delete(id: string): Observable<void> {
    return mockResult(() => this.store.deleteAccount(id), this.latencyMs);
  }
}
