import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ExchangeRateRepository } from '../exchange-rate.repository';
import { ExchangeRate } from '../../domain/models/exchange-rate';
import { MOCK_LATENCY_MS } from './mock-latency';
import { mockResult } from './mock-result';

/**
 * Fixed rates for a small set of pairs - enough to make the dashboard's
 * multi-currency conversion feel real without needing a live provider.
 * EUR is deliberately absent: the seeded EUR investment account (see
 * data/mock/fixtures.ts) exists specifically to fall through to the 1:1
 * fallback below and exercise shared/exchange-rate-warning on a real
 * screen, matching the real backend's fallback contract described in
 * docs/money-and-currency.md.
 */
const KNOWN_RATES: Record<string, string> = {
  USD_BRL: '5.20',
  BRL_USD: '0.1923',
  GBP_BRL: '6.55',
  BRL_GBP: '0.1527'
};

@Injectable({ providedIn: 'root' })
export class MockExchangeRateRepository extends ExchangeRateRepository {
  private readonly latencyMs = inject(MOCK_LATENCY_MS);

  getRate(baseCode: string, quoteCode: string): Observable<ExchangeRate> {
    return mockResult(() => this.resolve(baseCode, quoteCode), this.latencyMs);
  }

  private resolve(baseCode: string, quoteCode: string): ExchangeRate {
    if (baseCode === quoteCode) {
      return { baseCode, quoteCode, rate: '1', isFallback: false };
    }

    const knownRate = KNOWN_RATES[`${baseCode}_${quoteCode}`];
    if (knownRate) {
      return { baseCode, quoteCode, rate: knownRate, isFallback: false };
    }

    // Never raise on a missing rate - always fall back to 1:1, flagged so
    // the UI can show a warning rather than use it silently.
    return { baseCode, quoteCode, rate: '1', isFallback: true };
  }
}
