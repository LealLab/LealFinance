import { TestBed } from '@angular/core/testing';
import { MOCK_LATENCY_MS } from './mock-latency';
import { MockExchangeRateRepository } from './mock-exchange-rate.repository';
import { MockStore } from './mock-store';
import { ExchangeRate } from '../../domain/models/exchange-rate';

describe('MockExchangeRateRepository', () => {
  let repository: MockExchangeRateRepository;
  let store: MockStore;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [{ provide: MOCK_LATENCY_MS, useValue: 0 }] });
    repository = TestBed.inject(MockExchangeRateRepository);
    store = TestBed.inject(MockStore);
  });

  function getRate(baseCode: string, quoteCode: string, asOf = '2026-08-14'): ExchangeRate {
    let result: ExchangeRate | undefined;
    repository.getRate(baseCode, quoteCode, asOf).subscribe((rate) => (result = rate));
    return result!;
  }

  it('resolves same-code pairs to 1 without checking manual rates or KNOWN_RATES', () => {
    expect(getRate('BRL', 'BRL')).toEqual({
      baseCode: 'BRL', quoteCode: 'BRL', rate: '1', isFallback: false,
      source: 'quote', asOf: '2026-08-14'
    });
  });

  it('prefers a manual rate over the built-in KNOWN_RATES table', () => {
    store.upsertManualRate({ baseCode: 'USD', quoteCode: 'BRL', rate: '5.55', asOf: '2020-01-01' });

    expect(getRate('USD', 'BRL')).toEqual({
      baseCode: 'USD',
      quoteCode: 'BRL',
      rate: '5.55',
      isFallback: false,
      source: 'manual',
      asOf: '2020-01-01'
    });
  });

  it('resolves the opposite direction of a manual rate by inverting it', () => {
    store.upsertManualRate({ baseCode: 'USD', quoteCode: 'BRL', rate: '5', asOf: '2020-01-01' });

    expect(getRate('BRL', 'USD')).toEqual({
      baseCode: 'BRL',
      quoteCode: 'USD',
      rate: '0.2000000000',
      isFallback: false,
      source: 'manual',
      asOf: '2020-01-01'
    });
  });

  it('uses the newest manual rate on or before today when several exist for the same pair', () => {
    store.upsertManualRate({ baseCode: 'USD', quoteCode: 'BRL', rate: '5', asOf: '2020-01-01' });
    store.upsertManualRate({ baseCode: 'USD', quoteCode: 'BRL', rate: '5.3', asOf: '2020-06-01' });

    expect(getRate('USD', 'BRL').rate).toBe('5.3');
  });

  it('ignores a manual rate dated after today', () => {
    store.upsertManualRate({ baseCode: 'USD', quoteCode: 'BRL', rate: '5', asOf: '2020-01-01' });
    store.upsertManualRate({ baseCode: 'USD', quoteCode: 'BRL', rate: '999', asOf: '2999-01-01' });

    expect(getRate('USD', 'BRL').rate).toBe('5');
  });

  it('falls back to KNOWN_RATES when no manual rate covers the pair', () => {
    expect(getRate('USD', 'BRL')).toEqual({
      baseCode: 'USD',
      quoteCode: 'BRL',
      rate: '5.20',
      isFallback: false,
      source: 'quote',
      asOf: '2026-08-14'
    });
  });

  it('falls back to a 1:1 approximation, flagged, for an unrecognized pair', () => {
    expect(getRate('USD', 'EUR')).toEqual({
      baseCode: 'USD', quoteCode: 'EUR', rate: '1', isFallback: true,
      source: 'fallback', asOf: '2026-08-14'
    });
  });
});
