import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import {
  AnalyticsRepository,
  CategorySpend,
  MonthlyTotal,
  AccountBalancePoint,
} from '../analytics.repository';
import { accountBalance } from '../../domain/calc/balances';
import { categoryBreakdown, totalsFor } from '../../domain/calc/aggregations';
import { effectiveAmount } from '../../domain/calc/conversion';
import { formatIsoDate } from '../../domain/calc/dates';
import { Transaction } from '../../domain/models/transaction';
import { MockStore } from './mock-store';
import { MOCK_LATENCY_MS } from './mock-latency';
import { mockResult } from './mock-result';

@Injectable({ providedIn: 'root' })
export class MockAnalyticsRepository extends AnalyticsRepository {
  private readonly store = inject(MockStore);
  private readonly latencyMs = inject(MOCK_LATENCY_MS);

  monthlyTotals(dateFrom: string, dateTo: string): Observable<MonthlyTotal[]> {
    return mockResult(() => {
      const groups = new Map<string, Transaction[]>();
      for (const transaction of this.store.transactions()) {
        if (
          transaction.date < dateFrom ||
          transaction.date > dateTo ||
          (transaction.type !== 'income' && transaction.type !== 'expense')
        ) {
          continue;
        }
        const key = `${transaction.date.slice(0, 7)}:${effectiveAmount(transaction).currency}`;
        groups.set(key, [...(groups.get(key) ?? []), transaction]);
      }

      return Array.from(groups, ([key, transactions]) => {
        const [month, currency] = key.split(':');
        const totals = totalsFor(transactions, currency);
        return {
          month,
          currency,
          income: totals.income.amount,
          expense: totals.expense.amount,
          net: totals.net.amount,
        };
      }).sort((a, b) => a.month.localeCompare(b.month) || a.currency.localeCompare(b.currency));
    }, this.latencyMs);
  }

  categorySpend(dateFrom: string, dateTo: string): Observable<CategorySpend[]> {
    return mockResult(() => {
      const groups = new Map<string, Transaction[]>();
      for (const transaction of this.store.transactions()) {
        if (
          transaction.type !== 'expense' ||
          transaction.date < dateFrom ||
          transaction.date > dateTo
        ) {
          continue;
        }
        const key = effectiveAmount(transaction).currency;
        groups.set(key, [...(groups.get(key) ?? []), transaction]);
      }

      return Array.from(groups, ([currency, transactions]) =>
        categoryBreakdown(transactions, this.store.categories(), currency).map((row) => ({
          groupId: row.groupId,
          currency,
          total: row.total.amount,
        })),
      )
        .flat()
        .sort((a, b) => a.groupId.localeCompare(b.groupId) || a.currency.localeCompare(b.currency));
    }, this.latencyMs);
  }

  balanceTrend(months: readonly string[]): Observable<AccountBalancePoint[]> {
    return mockResult(() => {
      const accounts = this.store.accounts();
      return months.flatMap((month) => {
        const start = new Date(`${month}-01T00:00:00Z`);
        const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
        const transactions = this.store
          .transactions()
          .filter((transaction) => transaction.date <= formatIsoDate(end));
        return accounts.map((account) => ({
          month,
          accountId: account.id,
          currency: account.currency,
          balance: accountBalance(account, transactions).amount,
        }));
      });
    }, this.latencyMs);
  }
}
