import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { HttpAccountRepository } from './http-account.repository';
import { HttpAgentProviderRepository } from './http-agent-provider.repository';
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

  it('posts CSV content and mapping to the import preview endpoint', () => {
    let preview: unknown;
    TestBed.inject(HttpTransactionRepository)
      .importPreview({
        content: 'date,amount\n2026-01-01,-5\n',
        accountId: 'a',
        mapping: { date: 'date', amount: 'amount' },
        options: { dateFormat: 'auto', decimalSeparator: 'auto', invertSign: false },
      })
      .subscribe((result) => (preview = result));
    const req = http.expectOne('/api/v1/transactions/import/preview');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      content: 'date,amount\n2026-01-01,-5\n',
      account_id: 'a',
      mapping: { date: 'date', amount: 'amount' },
      options: { date_format: 'auto', decimal_separator: 'auto', invert_sign: false },
    });
    req.flush({
      headers: ['date', 'amount'],
      mapping: { date: 'date', description: null, amount: 'amount', category: null, notes: null },
      rows: [],
    });
    expect(preview).toEqual({
      headers: ['date', 'amount'],
      mapping: { date: 'date', description: null, amount: 'amount', category: null, notes: null },
      rows: [],
    });
  });

  it('posts reviewed rows to the import commit endpoint and returns the created count', () => {
    let created: number | undefined;
    TestBed.inject(HttpTransactionRepository)
      .importCommit([
        {
          type: 'expense',
          date: '2026-01-15',
          amount: '5.00',
          currency: 'BRL',
          accountId: 'a',
          categoryId: 'c',
          description: 'Coffee',
        },
      ])
      .subscribe((result) => (created = result));
    const req = http.expectOne('/api/v1/transactions/import');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      items: [
        {
          type: 'expense',
          date: '2026-01-15',
          amount: '5.00',
          currency: 'BRL',
          account_id: 'a',
          to_account_id: null,
          category_id: 'c',
          description: 'Coffee',
          notes: null,
          recurring_rule_id: null,
          conversion: null,
        },
      ],
    });
    req.flush({ created: 1 });
    expect(created).toBe(1);
  });

  it('lists and maps agent provider status', () => {
    let statuses: unknown;
    TestBed.inject(HttpAgentProviderRepository)
      .list()
      .subscribe((result) => (statuses = result));
    const req = http.expectOne('/api/v1/agents/providers');
    expect(req.request.method).toBe('GET');
    req.flush([
      {
        provider: 'anthropic',
        configured: true,
        source: 'env',
        auth_mode: 'api_key',
        auth_modes: ['api_key', 'oauth'],
        account_label: null,
        model: 'claude-sonnet-5',
        models: ['claude-opus-5', 'claude-sonnet-5'],
      },
    ]);
    expect(statuses).toEqual([
      {
        provider: 'anthropic',
        configured: true,
        source: 'env',
        authMode: 'api_key',
        authModes: ['api_key', 'oauth'],
        accountLabel: undefined,
        model: 'claude-sonnet-5',
        models: ['claude-opus-5', 'claude-sonnet-5'],
      },
    ]);
  });

  it('links a provider with an api key, omitting unset fields', () => {
    TestBed.inject(HttpAgentProviderRepository)
      .link('anthropic', { apiKey: 'sk-x' })
      .subscribe();
    const req = http.expectOne('/api/v1/agents/providers/anthropic');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ api_key: 'sk-x' });
    req.flush({
      provider: 'anthropic',
      configured: true,
      source: 'user',
      auth_mode: 'api_key',
      auth_modes: ['api_key', 'oauth'],
      account_label: null,
      model: 'claude-sonnet-5',
      models: [],
    });
  });

  it('unlinks a provider', () => {
    TestBed.inject(HttpAgentProviderRepository).unlink('openai').subscribe();
    const req = http.expectOne('/api/v1/agents/providers/openai');
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });

  it('starts and completes OAuth linking', () => {
    let start: unknown;
    TestBed.inject(HttpAgentProviderRepository)
      .startOAuth('anthropic')
      .subscribe((result) => (start = result));
    const startReq = http.expectOne('/api/v1/agents/providers/anthropic/oauth/start');
    expect(startReq.request.method).toBe('POST');
    startReq.flush({ authorize_url: 'https://claude.ai/oauth/authorize?x=1', verifier: 'v', state: 's' });
    expect(start).toEqual({ authorizeUrl: 'https://claude.ai/oauth/authorize?x=1', verifier: 'v', state: 's' });

    TestBed.inject(HttpAgentProviderRepository)
      .completeOAuth('anthropic', { verifier: 'v', state: 's', code: 'c#s' })
      .subscribe();
    const completeReq = http.expectOne('/api/v1/agents/providers/anthropic/oauth/complete');
    expect(completeReq.request.method).toBe('POST');
    expect(completeReq.request.body).toEqual({ verifier: 'v', state: 's', code: 'c#s' });
    completeReq.flush({
      provider: 'anthropic',
      configured: true,
      source: 'user',
      auth_mode: 'oauth',
      auth_modes: ['api_key', 'oauth'],
      account_label: 'Claude subscription',
      model: 'claude-sonnet-5',
      models: [],
    });
  });

  it('tests a provider connection', () => {
    let result: unknown;
    TestBed.inject(HttpAgentProviderRepository)
      .test('ollama')
      .subscribe((r) => (result = r));
    const req = http.expectOne('/api/v1/agents/providers/ollama/test');
    expect(req.request.method).toBe('POST');
    req.flush({ ok: false, error_code: 'agents.provider_unavailable' });
    expect(result).toEqual({ ok: false, errorCode: 'agents.provider_unavailable' });
  });

  it('sends a chat message, including provider only when set', () => {
    TestBed.inject(HttpAgentProviderRepository)
      .chat([{ role: 'user', content: 'hi' }])
      .subscribe();
    const req = http.expectOne('/api/v1/agents/chat');
    expect(req.request.body).toEqual({ messages: [{ role: 'user', content: 'hi' }] });
    req.flush({ provider: 'anthropic', model: 'claude-sonnet-5', reply: 'hello' });
  });
});
