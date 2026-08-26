import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { ApiClient } from '../../core/api-client';
import { InvestmentAsset } from '../../domain/models/investment';
import {
  InvestmentAssetCreate,
  InvestmentAssetRepository,
  InvestmentAssetUpdate,
} from '../investment-asset.repository';
import {
  mapInvestmentAsset,
  mapInvestmentAssetCreate,
  mapInvestmentAssetPatch,
} from './mappers';
import { InvestmentAssetWire } from './wire-dtos';

@Injectable({ providedIn: 'root' })
export class HttpInvestmentAssetRepository extends InvestmentAssetRepository {
  private readonly api = inject(ApiClient);

  list(): Observable<InvestmentAsset[]> {
    return this.api
      .get<InvestmentAssetWire[]>('/investments/assets')
      .pipe(map((items) => items.map(mapInvestmentAsset)));
  }

  create(input: InvestmentAssetCreate): Observable<InvestmentAsset> {
    return this.api
      .post<InvestmentAssetWire>('/investments/assets', mapInvestmentAssetCreate(input))
      .pipe(map(mapInvestmentAsset));
  }

  update(id: string, changes: InvestmentAssetUpdate): Observable<InvestmentAsset> {
    return this.api
      .patch<InvestmentAssetWire>(`/investments/assets/${id}`, mapInvestmentAssetPatch(changes))
      .pipe(map(mapInvestmentAsset));
  }

  setArchived(id: string, archived: boolean): Observable<InvestmentAsset> {
    return this.api
      .post<InvestmentAssetWire>(`/investments/assets/${id}/archive`, { archived })
      .pipe(map(mapInvestmentAsset));
  }
}
