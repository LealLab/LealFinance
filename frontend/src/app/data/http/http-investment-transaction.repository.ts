import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { ApiClient, ApiQueryParams } from '../../core/api-client';
import { InvestmentTransaction } from '../../domain/models/investment';
import {
  InvestmentTransactionCreate,
  InvestmentTransactionRepository,
  InvestmentTransactionUpdate,
} from '../investment-transaction.repository';
import {
  mapInvestmentTransaction,
  mapInvestmentTransactionCreate,
  mapInvestmentTransactionPatch,
} from './mappers';
import { InvestmentTransactionWire } from './wire-dtos';

@Injectable({ providedIn: 'root' })
export class HttpInvestmentTransactionRepository extends InvestmentTransactionRepository {
  private readonly api = inject(ApiClient);

  list(params: {
    walletId: string;
    limit?: number;
    offset?: number;
  }): Observable<InvestmentTransaction[]> {
    const query: ApiQueryParams = { limit: params.limit, offset: params.offset };
    return this.api
      .get<InvestmentTransactionWire[]>(`/investments/wallets/${params.walletId}/transactions`, query)
      .pipe(map((items) => items.map(mapInvestmentTransaction)));
  }

  create(input: InvestmentTransactionCreate): Observable<InvestmentTransaction> {
    return this.api
      .post<InvestmentTransactionWire>('/investments/transactions', mapInvestmentTransactionCreate(input))
      .pipe(map(mapInvestmentTransaction));
  }

  update(id: string, changes: InvestmentTransactionUpdate): Observable<InvestmentTransaction> {
    return this.api
      .patch<InvestmentTransactionWire>(
        `/investments/transactions/${id}`,
        mapInvestmentTransactionPatch(changes),
      )
      .pipe(map(mapInvestmentTransaction));
  }

  delete(id: string): Observable<void> {
    return this.api.delete(`/investments/transactions/${id}`);
  }
}
