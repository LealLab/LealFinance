import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ExchangeRateRepository } from '../exchange-rate.repository';
import { ExchangeRate } from '../../domain/models/exchange-rate';
import { ManualRate } from '../../domain/models/manual-rate';
import { formatIsoDate } from '../../domain/calc/dates';
import { invertRate } from '../../shared/money/rate';
import { MOCK_LATENCY_MS } from './mock-latency';
import { mockResult } from './mock-result';
import { MockStore } from './mock-store';

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
  BRL_GBP: '0.1527',
};

@Injectable({ providedIn: 'root' })
export class MockExchangeRateRepository extends ExchangeRateRepository {
  private readonly store = inject(MockStore);
  private readonly latencyMs = inject(MOCK_LATENCY_MS);

  getRate(
    baseCode: string,
    quoteCode: string,
    asOf = formatIsoDate(new Date()),
  ): Observable<ExchangeRate> {
    return mockResult(() => this.resolve(baseCode, quoteCode, asOf), this.latencyMs);
  }

  /**
   * Resolution order, each step outranking the next: identity, a manual
   * rate the user entered (direct or inverted), the built-in demo table,
   * then a flagged 1:1 guess. See domain/models/manual-rate.ts - manual
   * rates outrank the provider on the real backend too.
   */
  private resolve(baseCode: string, quoteCode: string, asOf: string): ExchangeRate {
    if (baseCode === quoteCode) {
      return { baseCode, quoteCode, rate: '1', isFallback: false, source: 'quote', asOf };
    }

    const manualRate = this.resolveManualRate(baseCode, quoteCode, asOf);
    if (manualRate) {
      return {
        baseCode,
        quoteCode,
        rate: manualRate.rate,
        isFallback: false,
        source: 'manual',
        asOf: manualRate.asOf,
      };
    }

    const knownRate = KNOWN_RATES[`${baseCode}_${quoteCode}`];
    if (knownRate) {
      return { baseCode, quoteCode, rate: knownRate, isFallback: false, source: 'quote', asOf };
    }

    // Never raise on a missing rate - always fall back to 1:1, flagged so
    // the UI can show a warning rather than use it silently.
    return { baseCode, quoteCode, rate: '1', isFallback: true, source: 'fallback', asOf };
  }

  /** The newest manual rate for the pair on or before today, direct or inverted - `undefined` if none covers it. */
  private resolveManualRate(
    baseCode: string,
    quoteCode: string,
    asOf: string,
  ): { rate: string; asOf: string } | undefined {
    const direct = this.newestOnOrBefore(baseCode, quoteCode, asOf);
    if (direct) return { rate: direct.rate, asOf: direct.asOf };

    const inverse = this.newestOnOrBefore(quoteCode, baseCode, asOf);
    return inverse ? { rate: invertRate(inverse.rate), asOf: inverse.asOf } : undefined;
  }

  private newestOnOrBefore(
    baseCode: string,
    quoteCode: string,
    today: string,
  ): ManualRate | undefined {
    return this.store
      .manualRates()
      .filter(
        (rate) => rate.baseCode === baseCode && rate.quoteCode === quoteCode && rate.asOf <= today,
      )
      .sort((a, b) => b.asOf.localeCompare(a.asOf))[0];
  }
}
