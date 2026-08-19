import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { HttpAccountRepository } from './http-account.repository';
import { HttpExchangeRateRepository } from './http-exchange-rate.repository';
import { HttpGoalRepository } from './http-goal.repository';
import { HttpManualRateRepository } from './http-manual-rate.repository';
import { HttpTransactionRepository } from './http-transaction.repository';

describe('HTTP repositories', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('sends transaction filters with backend parameter names', () => {
    TestBed.inject(HttpTransactionRepository)
      .list({ accountId: 'a', types: ['expense'], dateFrom: '2026-08-01' })
      .subscribe();
    const req = http.expectOne((r) => r.url === '/api/v1/transactions');
    expect(req.request.params.get('account_id')).toBe('a');
    expect(req.request.params.getAll('type')).toEqual(['expense']);
    expect(req.request.params.get('date_from')).toBe('2026-08-01');
    req.flush([]);
  });

  it('sends search, institution, repeated type, and paging params', () => {
    TestBed.inject(HttpTransactionRepository)
      .list({
        search: 'coffee',
        institutionId: 'i',
        types: ['income', 'expense'],
        limit: 20,
        offset: 40,
      })
      .subscribe();
    const req = http.expectOne((r) => r.url === '/api/v1/transactions');
    expect(req.request.params.get('search')).toBe('coffee');
    expect(req.request.params.get('institution_id')).toBe('i');
    expect(req.request.params.getAll('type')).toEqual(['income', 'expense']);
    expect(req.request.params.get('limit')).toBe('20');
    expect(req.request.params.get('offset')).toBe('40');
    req.flush([]);
  });

  it('fetches and maps account balances', () => {
    let balances: unknown;
    TestBed.inject(HttpAccountRepository)
      .balances()
      .subscribe((result) => (balances = result));
    const req = http.expectOne('/api/v1/accounts/balances');
    expect(req.request.method).toBe('GET');
    req.flush([{ account_id: 'a', currency: 'BRL', balance: '300.0000' }]);
    expect(balances).toEqual([{ accountId: 'a', currency: 'BRL', balance: '300.0000' }]);
  });

  it('uses the atomic goal create endpoint and maps its aggregate response', () => {
    let goalId: string | undefined;
    TestBed.inject(HttpGoalRepository)
      .create({ name: 'Home', targetAmount: '1000', currency: 'BRL', archived: false })
      .subscribe((goal) => (goalId = goal.id));
    const req = http.expectOne('/api/v1/goals/with-account');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      name: 'Home',
      target_amount: '1000',
      currency: 'BRL',
      target_date: null,
      frequency: null,
      interval: null,
      archived: false,
    });
    req.flush({
      goal: {
        id: 'g',
        account_id: 'a',
        name: 'Home',
        target_amount: '1000',
        currency: 'BRL',
        target_date: null,
        frequency: null,
        interval: null,
        archived: false,
      },
      account: {
        id: 'a',
        name: 'Home',
        type: 'goal',
        currency: 'BRL',
        opening_balance: '0',
        institution_id: null,
        archived: false,
        credit_limit: null,
        closing_day: null,
        due_day: null,
      },
    });
    expect(goalId).toBe('g');
  });

  it('uses pair and effective date as manual-rate path keys', () => {
    TestBed.inject(HttpManualRateRepository)
      .upsert({ baseCode: 'usd', quoteCode: 'brl', rate: '5.2', asOf: '2026-08-14' })
      .subscribe();
    const req = http.expectOne('/api/v1/manual-rates/USD_BRL/2026-08-14');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ rate: '5.2' });
    req.flush({ id: 'm', base_code: 'USD', quote_code: 'BRL', rate: '5.2', as_of: '2026-08-14' });
  });

  it('passes the requested transaction date to exchange lookup', () => {
    TestBed.inject(HttpExchangeRateRepository).getRate('USD', 'BRL', '2026-08-10').subscribe();
    const req = http.expectOne((r) => r.url === '/api/v1/meta/exchange-rate');
    expect(req.request.params.get('as_of')).toBe('2026-08-10');
    req.flush({
      base_code: 'USD',
      quote_code: 'BRL',
      rate: '5.2',
      is_fallback: false,
      source: 'provider',
      as_of: '2026-08-10',
    });
  });
});
