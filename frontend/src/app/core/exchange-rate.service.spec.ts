import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { ExchangeRateService } from './exchange-rate.service';
import { ExchangeRateQuote } from './models/exchange-rate';

describe('ExchangeRateService', () => {
  let service: ExchangeRateService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(ExchangeRateService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('requests the exchange rate with base/quote as query params', () => {
    const expected: ExchangeRateQuote = {
      base_code: 'USD',
      quote_code: 'BRL',
      rate: '1',
      is_fallback: true,
      source: 'fallback_1to1',
      as_of: '2026-08-13'
    };

    let result: ExchangeRateQuote | undefined;
    service.getRate('USD', 'BRL').subscribe((quote) => (result = quote));

    const req = httpMock.expectOne(
      (r) => r.url === '/api/v1/meta/exchange-rate' && r.params.get('base') === 'USD' && r.params.get('quote') === 'BRL'
    );
    expect(req.request.method).toBe('GET');
    req.flush(expected);

    expect(result).toEqual(expected);
  });
});
