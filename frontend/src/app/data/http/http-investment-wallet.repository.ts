import { inject, Injectable } from '@angular/core';
import { catchError, map, Observable } from 'rxjs';
import { ApiClient } from '../../core/api-client';
import {
  InvestmentPosition,
  InvestmentSummary,
  InvestmentWallet,
} from '../../domain/models/investment';
import {
  InvestmentWalletCreate,
  InvestmentWalletRepository,
  InvestmentWalletUpdate,
} from '../investment-wallet.repository';
import {
  mapInvestmentPosition,
  mapInvestmentSummary,
  mapInvestmentWallet,
  mapInvestmentWalletCreate,
  mapInvestmentWalletPatch,
} from './mappers';
import { notFoundOrThrow } from './repository-errors';
import {
  InvestmentPositionWire,
  InvestmentSummaryWire,
  InvestmentWalletWire,
} from './wire-dtos';

@Injectable({ providedIn: 'root' })
export class HttpInvestmentWalletRepository extends InvestmentWalletRepository {
  private readonly api = inject(ApiClient);

  list(): Observable<InvestmentWallet[]> {
    return this.api
      .get<InvestmentWalletWire[]>('/investments/wallets')
      .pipe(map((items) => items.map(mapInvestmentWallet)));
  }

  get(id: string): Observable<InvestmentWallet | undefined> {
    return this.api.get<InvestmentWalletWire>(`/investments/wallets/${id}`).pipe(
      map(mapInvestmentWallet),
      catchError((e) => notFoundOrThrow<InvestmentWallet>(e, 'investment_wallet.not_found')),
    );
  }

  create(input: InvestmentWalletCreate): Observable<InvestmentWallet> {
    return this.api
      .post<InvestmentWalletWire>('/investments/wallets', mapInvestmentWalletCreate(input))
      .pipe(map(mapInvestmentWallet));
  }

  update(id: string, changes: InvestmentWalletUpdate): Observable<InvestmentWallet> {
    return this.api
      .patch<InvestmentWalletWire>(`/investments/wallets/${id}`, mapInvestmentWalletPatch(changes))
      .pipe(map(mapInvestmentWallet));
  }

  setArchived(id: string, archived: boolean): Observable<InvestmentWallet> {
    return this.api
      .post<InvestmentWalletWire>(`/investments/wallets/${id}/archive`, { archived })
      .pipe(map(mapInvestmentWallet));
  }

  positions(walletId: string): Observable<InvestmentPosition[]> {
    return this.api
      .get<InvestmentPositionWire[]>(`/investments/wallets/${walletId}/positions`)
      .pipe(map((items) => items.map(mapInvestmentPosition)));
  }

  summary(): Observable<InvestmentSummary> {
    return this.api
      .get<InvestmentSummaryWire>('/investments/summary')
      .pipe(map(mapInvestmentSummary));
  }
}
