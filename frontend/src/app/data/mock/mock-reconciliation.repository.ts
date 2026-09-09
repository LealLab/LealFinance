import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiError } from '../../core/api-error';
import { Account } from '../../domain/models/account';
import { Reconciliation, ReconciliationDetail, ReconciliationEntry } from '../../domain/models/reconciliation';
import { Transaction } from '../../domain/models/transaction';
import { add, isZero, money, subtract, sum } from '../../shared/money/money';
import { ReconciliationCreateInput, ReconciliationRepository } from '../reconciliation.repository';
import { findEntity } from './entity-list.utils';
import { MOCK_LATENCY_MS } from './mock-latency';
import { mockResult } from './mock-result';
import { MockStore } from './mock-store';

interface Leg {
  transaction: Transaction;
  leg: 'own' | 'incoming';
  amount: string;
}

interface StoredEntry extends ReconciliationEntry {
  accountId: string;
}

@Injectable({ providedIn: 'root' })
export class MockReconciliationRepository extends ReconciliationRepository {
  private readonly store = inject(MockStore);
  private readonly latencyMs = inject(MOCK_LATENCY_MS);
  private reconciliations: Reconciliation[] = [];
  private entries: StoredEntry[] = [];

  list(accountId?: string): Observable<Reconciliation[]> {
    return mockResult(
      () => this.reconciliations.filter((item) => !accountId || item.accountId === accountId),
      this.latencyMs,
    );
  }

  create(input: ReconciliationCreateInput): Observable<Reconciliation> {
    return mockResult(() => {
      const account = this.account(input.accountId);
      if (account.archived) throw new ApiError(422, 'reconciliation.account_archived', {});
      if (this.reconciliations.some((item) => item.accountId === account.id && item.status === 'open')) {
        throw new ApiError(409, 'reconciliation.already_open', {});
      }
      const reconciliation: Reconciliation = {
        id: crypto.randomUUID(),
        accountId: account.id,
        statementDate: input.statementDate,
        statementBalance: money(input.statementBalance, account.currency).amount,
        currency: account.currency,
        status: 'open',
        createdAt: new Date().toISOString(),
      };
      this.reconciliations = [...this.reconciliations, reconciliation];
      return reconciliation;
    }, this.latencyMs);
  }

  detail(id: string): Observable<ReconciliationDetail> {
    return mockResult(() => this.buildDetail(this.reconciliation(id)), this.latencyMs);
  }

  setEntries(id: string, transactionIds: string[], cleared: boolean): Observable<ReconciliationDetail> {
    return mockResult(() => {
      const reconciliation = this.reconciliation(id);
      if (reconciliation.status !== 'open') throw new ApiError(409, 'reconciliation.completed', {});
      const legs = this.legs(reconciliation);
      for (const transactionId of transactionIds) {
        if (!legs.some((leg) => leg.transaction.id === transactionId)) {
          throw new ApiError(422, 'reconciliation.transaction_not_eligible', {});
        }
        const leg = legs.find((candidate) => candidate.transaction.id === transactionId)!;
        const existing = this.entries.find(
          (entry) => entry.transactionId === transactionId && entry.accountId === reconciliation.accountId,
        );
        if (existing && existing.clearedBy !== id && !cleared) {
          throw new ApiError(409, 'reconciliation.leg_locked', {});
        }
        if (cleared && !existing) {
          this.entries = [
            ...this.entries,
            {
              transactionId,
              accountId: reconciliation.accountId,
              leg: leg.leg,
              date: leg.transaction.date,
              description: leg.transaction.description,
              amount: leg.amount,
              cleared: true,
              clearedBy: id,
            },
          ];
        } else if (!cleared && existing) {
          this.entries = this.entries.filter((entry) => entry !== existing);
        }
      }
      return this.buildDetail(reconciliation);
    }, this.latencyMs);
  }

  complete(id: string): Observable<Reconciliation> {
    return mockResult(() => {
      const reconciliation = this.reconciliation(id);
      if (!isZero(money(this.buildDetail(reconciliation).difference, reconciliation.currency))) {
        throw new ApiError(422, 'reconciliation.difference_not_zero', {});
      }
      reconciliation.status = 'completed';
      reconciliation.completedAt = new Date().toISOString();
      return reconciliation;
    }, this.latencyMs);
  }

  reopen(id: string): Observable<Reconciliation> {
    return mockResult(() => {
      const reconciliation = this.reconciliation(id);
      if (this.reconciliations.some((item) => item.id !== id && item.accountId === reconciliation.accountId && item.status === 'open')) {
        throw new ApiError(409, 'reconciliation.already_open', {});
      }
      reconciliation.status = 'open';
      reconciliation.completedAt = undefined;
      return reconciliation;
    }, this.latencyMs);
  }

  remove(id: string): Observable<void> {
    return mockResult(() => {
      this.reconciliation(id);
      this.reconciliations = this.reconciliations.filter((item) => item.id !== id);
      this.entries = this.entries.filter((entry) => entry.clearedBy !== id);
    }, this.latencyMs);
  }

  private account(id: string): Account {
    const account = this.store.accounts().find((item) => item.id === id);
    if (!account) throw new ApiError(404, 'account.not_found', { id });
    return account;
  }

  private reconciliation(id: string): Reconciliation {
    const reconciliation = findEntity(this.reconciliations, id);
    if (!reconciliation) throw new ApiError(404, 'reconciliation.not_found', { id });
    return reconciliation;
  }

  private legs(reconciliation: Reconciliation): Leg[] {
    return this.store.transactions()
      .filter((transaction) => transaction.date <= reconciliation.statementDate)
      .flatMap((transaction) => {
        const effective = transaction.conversion?.amount ?? transaction.amount;
        const own = transaction.accountId === reconciliation.accountId
          ? [{ transaction, leg: 'own' as const, amount: transaction.type === 'transfer'
            ? money(`-${transaction.amount}`, reconciliation.currency).amount
            : money(transaction.type === 'expense' ? `-${effective}` : effective, reconciliation.currency).amount }]
          : [];
        const incoming = transaction.type === 'transfer' && transaction.toAccountId === reconciliation.accountId
          ? [{ transaction, leg: 'incoming' as const, amount: money(effective, reconciliation.currency).amount }]
          : [];
        return [...own, ...incoming];
      });
  }

  private buildDetail(reconciliation: Reconciliation): ReconciliationDetail {
    const account = this.account(reconciliation.accountId);
    const legs = this.legs(reconciliation);
    const allDeltas = sum(legs.map((leg) => money(leg.amount, reconciliation.currency)), reconciliation.currency);
    const clearedDeltas = sum(
      legs
        .filter((leg) => this.entries.some(
          (entry) => entry.transactionId === leg.transaction.id
            && entry.accountId === reconciliation.accountId,
        ))
        .map((leg) => money(leg.amount, reconciliation.currency)),
      reconciliation.currency,
    );
    const entries = legs.map((leg) => {
      const cleared = this.entries.find(
        (entry) => entry.transactionId === leg.transaction.id
          && entry.accountId === reconciliation.accountId,
      );
      return {
        transactionId: leg.transaction.id,
        leg: leg.leg,
        date: leg.transaction.date,
        description: leg.transaction.description,
        amount: leg.amount,
        cleared: !!cleared,
        clearedBy: cleared?.clearedBy,
      };
    });
    const book = add(money(account.openingBalance, reconciliation.currency), allDeltas);
    const cleared = add(money(account.openingBalance, reconciliation.currency), clearedDeltas);
    const difference = subtract(money(reconciliation.statementBalance, reconciliation.currency), cleared);
    return {
      reconciliation,
      statementBalance: reconciliation.statementBalance,
      bookBalance: book.amount,
      clearedBalance: cleared.amount,
      difference: difference.amount,
      entries,
    };
  }
}
