import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { ApiClient } from '../../core/api-client';
import {
  AccountBalancePoint,
  AnalyticsRepository,
  CategorySpend,
  MonthlyTotal,
} from '../analytics.repository';
import { mapAccountBalancePoint, mapCategorySpend, mapMonthlyTotal } from './mappers';
import { AccountBalancePointWire, CategorySpendWire, MonthlyTotalWire } from './wire-dtos';

@Injectable({ providedIn: 'root' })
export class HttpAnalyticsRepository extends AnalyticsRepository {
  private readonly api = inject(ApiClient);

  monthlyTotals(dateFrom: string, dateTo: string): Observable<MonthlyTotal[]> {
    return this.api
      .get<MonthlyTotalWire[]>('/analytics/monthly-totals', {
        date_from: dateFrom,
        date_to: dateTo,
      })
      .pipe(map((items) => items.map(mapMonthlyTotal)));
  }

  categorySpend(dateFrom: string, dateTo: string): Observable<CategorySpend[]> {
    return this.api
      .get<CategorySpendWire[]>('/analytics/category-spend', {
        date_from: dateFrom,
        date_to: dateTo,
      })
      .pipe(map((items) => items.map(mapCategorySpend)));
  }

  balanceTrend(months: readonly string[]): Observable<AccountBalancePoint[]> {
    return this.api
      .get<AccountBalancePointWire[]>('/analytics/balance-trend', { months })
      .pipe(map((items) => items.map(mapAccountBalancePoint)));
  }
}
