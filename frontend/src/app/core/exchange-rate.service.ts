import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiClient } from './api-client';
import { ExchangeRateQuote } from './models/exchange-rate';

@Injectable({ providedIn: 'root' })
export class ExchangeRateService {
  private readonly api = inject(ApiClient);

  getRate(baseCode: string, quoteCode: string): Observable<ExchangeRateQuote> {
    return this.api.get<ExchangeRateQuote>('/meta/exchange-rate', {
      base: baseCode,
      quote: quoteCode
    });
  }
}
