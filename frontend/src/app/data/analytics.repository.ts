import { Observable } from 'rxjs';

export interface MonthlyTotal {
  month: string;
  currency: string;
  income: string;
  expense: string;
  net: string;
}

export interface CategorySpend {
  groupId: string;
  currency: string;
  total: string;
}

export interface AccountBalancePoint {
  month: string;
  accountId: string;
  currency: string;
  balance: string;
}

export abstract class AnalyticsRepository {
  abstract monthlyTotals(dateFrom: string, dateTo: string): Observable<MonthlyTotal[]>;
  abstract categorySpend(dateFrom: string, dateTo: string): Observable<CategorySpend[]>;
  abstract balanceTrend(months: readonly string[]): Observable<AccountBalancePoint[]>;
}
