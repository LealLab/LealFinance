import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { ApiClient } from '../../core/api-client';
import { ExchangeRate } from '../../domain/models/exchange-rate';
import { ExchangeRateRepository } from '../exchange-rate.repository';
import { mapExchangeRate } from './mappers';
import { ExchangeRateWire } from './wire-dtos';

@Injectable({ providedIn: 'root' })
export class HttpExchangeRateRepository extends ExchangeRateRepository {
  private readonly api = inject(ApiClient);
  getRate(baseCode: string, quoteCode: string, asOf?: string): Observable<ExchangeRate> {
    return this.api
      .get<ExchangeRateWire>('/meta/exchange-rate', {
        base: baseCode,
        quote: quoteCode,
        as_of: asOf,
      })
      .pipe(map(mapExchangeRate));
  }
}
