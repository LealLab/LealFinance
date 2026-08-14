import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { ApiClient } from '../../core/api-client';
import { ManualRate } from '../../domain/models/manual-rate';
import { ManualRateRepository } from '../manual-rate.repository';
import { mapManualRate } from './mappers';
import { ManualRateWire } from './wire-dtos';

@Injectable({ providedIn: 'root' })
export class HttpManualRateRepository extends ManualRateRepository {
  private readonly api = inject(ApiClient);
  list(): Observable<ManualRate[]> {
    return this.api
      .get<ManualRateWire[]>('/manual-rates')
      .pipe(map((items) => items.map(mapManualRate)));
  }
  upsert(input: Omit<ManualRate, 'id'>): Observable<ManualRate> {
    const pair = `${input.baseCode.toUpperCase()}_${input.quoteCode.toUpperCase()}`;
    return this.api
      .put<ManualRateWire>(
        `/manual-rates/${encodeURIComponent(pair)}/${encodeURIComponent(input.asOf)}`,
        { rate: input.rate },
      )
      .pipe(map(mapManualRate));
  }
  delete(id: string): Observable<void> {
    return this.api.delete(`/manual-rates/${id}`);
  }
}
