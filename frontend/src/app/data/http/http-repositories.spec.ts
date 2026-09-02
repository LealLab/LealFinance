import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { HttpAccountRepository } from './http-account.repository';
import { HttpCardInvoiceRepository } from './http-card-invoice.repository';
import { HttpAgentChatRepository } from './http-agent-chat.repository';
import { HttpAgentProviderRepository } from './http-agent-provider.repository';
import { HttpBudgetPlanRepository } from './http-budget-plan.repository';
import { HttpBudgetRepository } from './http-budget.repository';
import { HttpCategoryGroupRepository } from './http-category-group.repository';
import { HttpCategoryRepository } from './http-category.repository';
import { HttpExchangeRateRepository } from './http-exchange-rate.repository';
import { HttpGoalRepository } from './http-goal.repository';
import { HttpInstitutionRepository } from './http-institution.repository';
import { HttpLoanRepository } from './http-loan.repository';
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

  it('uses category-group CRUD and reorder endpoints', () => {
    let groups: unknown;
    TestBed.inject(HttpCategoryGroupRepository).list().subscribe((result) => (groups = result));
    const listReq = http.expectOne('/api/v1/category-groups');
    expect(listReq.request.method).toBe('GET');
    listReq.flush([]);
    expect(groups).toEqual([]);

    TestBed.inject(HttpCategoryGroupRepository)
      .create({ name: 'Housing', kind: 'expense', color: '#000000', icon: 'home' })
      .subscribe();
    const createReq = http.expectOne('/api/v1/category-groups');
    expect(createReq.request.method).toBe('POST');
    expect(createReq.request.body).toEqual({
      name: 'Housing',
      kind: 'expense',
      color: '#000000',
      icon: 'home',
    });
    createReq.flush({
      id: 'g',
      name: 'Housing',
      kind: 'expense',
      color: '#000000',
      icon: 'home',
      position: 0,
    });

    TestBed.inject(HttpCategoryGroupRepository).update('g', { name: 'Home' }).subscribe();
    const updateReq = http.expectOne('/api/v1/category-groups/g');
    expect(updateReq.request.method).toBe('PATCH');
    expect(updateReq.request.body).toEqual({ name: 'Home' });
    updateReq.flush({ id: 'g', name: 'Home', kind: 'expense', color: '#000000', icon: 'home', position: 0 });

    TestBed.inject(HttpCategoryGroupRepository).reorder('expense', ['g']).subscribe();
    const reorderReq = http.expectOne('/api/v1/category-groups/reorder');
    expect(reorderReq.request.method).toBe('POST');
    expect(reorderReq.request.body).toEqual({ kind: 'expense', ordered_ids: ['g'] });
    reorderReq.flush(null);

    TestBed.inject(HttpCategoryGroupRepository).delete('g').subscribe();
    const deleteReq = http.expectOne('/api/v1/category-groups/g');
    expect(deleteReq.request.method).toBe('DELETE');
    deleteReq.flush(null);
  });

  it('uses group_id for category and budget endpoints', () => {
    TestBed.inject(HttpCategoryRepository)
      .create({ name: 'Rent', kind: 'expense', groupId: 'g', color: '#000000', icon: 'home' })
      .subscribe();
    const categoryCreate = http.expectOne('/api/v1/categories');
    expect(categoryCreate.request.method).toBe('POST');
    expect(categoryCreate.request.body).toEqual({
      name: 'Rent',
      kind: 'expense',
      group_id: 'g',
      color: '#000000',
      icon: 'home',
    });
    categoryCreate.flush({
      id: 'c',
      name: 'Rent',
      kind: 'expense',
      group_id: 'g',
      color: '#000000',
      icon: 'home',
      position: 0,
    });

    TestBed.inject(HttpCategoryRepository).reorder('expense', 'g', ['c']).subscribe();
    const categoryReorder = http.expectOne('/api/v1/categories/reorder');
    expect(categoryReorder.request.body).toEqual({ kind: 'expense', group_id: 'g', ordered_ids: ['c'] });
    categoryReorder.flush(null);

    TestBed.inject(HttpBudgetRepository)
      .upsert({ groupId: 'g', month: '2026-08', amount: '100', currency: 'BRL' })
      .subscribe();
    const budgetReq = http.expectOne('/api/v1/budgets');
    expect(budgetReq.request.method).toBe('PUT');
    expect(budgetReq.request.body).toEqual({ group_id: 'g', month: '2026-08', amount: '100', currency: 'BRL' });
    budgetReq.flush({ id: 'b', group_id: 'g', month: '2026-08', amount: '100', currency: 'BRL' });

    TestBed.inject(HttpBudgetPlanRepository)
      .upsertAllocation({ groupId: 'g', percentage: '20' })
      .subscribe();
    const allocationReq = http.expectOne('/api/v1/budget-allocations');
    expect(allocationReq.request.method).toBe('PUT');
    expect(allocationReq.request.body).toEqual({ group_id: 'g', percentage: '20' });
    allocationReq.flush({ id: 'a', group_id: 'g', percentage: '20' });
  });

  it('sends the institution delete mode', () => {
    TestBed.inject(HttpInstitutionRepository).delete('i', 'detach').subscribe();
    const req = http.expectOne((request) => request.url === '/api/v1/institutions/i');
    expect(req.request.method).toBe('DELETE');
    expect(req.request.params.get('mode')).toBe('detach');
    req.flush(null);
  });

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

  it('fetches and maps real account balances', () => {
    let balances: unknown;
    TestBed.inject(HttpAccountRepository)
      .realBalances()
      .subscribe((result) => (balances = result));
    const req = http.expectOne('/api/v1/accounts/real-balances');
    expect(req.request.method).toBe('GET');
    req.flush([{ account_id: 'a', currency: 'BRL', balance: '-50.0000' }]);
    expect(balances).toEqual([{ accountId: 'a', currency: 'BRL', balance: '-50.0000' }]);
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
          loan_id: null,
          card_invoice_close_date: null,
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
        default_model: 'claude-sonnet-5',
        models: ['claude-opus-5', 'claude-sonnet-5'],
        reasoning_effort: null,
        reasoning_efforts: ['low', 'medium', 'high', 'xhigh'],
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
        defaultModel: 'claude-sonnet-5',
        models: ['claude-opus-5', 'claude-sonnet-5'],
        reasoningEffort: undefined,
        reasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
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
      default_model: 'claude-sonnet-5',
      models: [],
      reasoning_effort: null,
      reasoning_efforts: [],
    });
  });

  it('links a provider with only a model, for changing the model on an already-linked provider', () => {
    TestBed.inject(HttpAgentProviderRepository)
      .link('anthropic', { model: 'claude-opus-5' })
      .subscribe();
    const req = http.expectOne('/api/v1/agents/providers/anthropic');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ model: 'claude-opus-5' });
    req.flush({
      provider: 'anthropic',
      configured: true,
      source: 'user',
      auth_mode: 'oauth',
      auth_modes: ['api_key', 'oauth'],
      account_label: 'Claude subscription',
      model: 'claude-opus-5',
      default_model: 'claude-sonnet-5',
      models: [],
      reasoning_effort: null,
      reasoning_efforts: [],
    });
  });

  it('links a provider with only a reasoning effort, without disturbing the model', () => {
    TestBed.inject(HttpAgentProviderRepository)
      .link('openai', { reasoningEffort: 'low' })
      .subscribe();
    const req = http.expectOne('/api/v1/agents/providers/openai');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ reasoning_effort: 'low' });
    req.flush({
      provider: 'openai',
      configured: true,
      source: 'user',
      auth_mode: 'oauth',
      auth_modes: ['api_key', 'oauth'],
      account_label: 'ChatGPT subscription',
      model: 'gpt-5.6-luna',
      default_model: 'gpt-5.6-luna',
      models: [],
      reasoning_effort: 'low',
      reasoning_efforts: ['low', 'medium', 'high', 'xhigh'],
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
      default_model: 'claude-sonnet-5',
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

  it('uses loan CRUD, archive, and payment endpoints', () => {
    const wire = {
      id: 'l',
      name: 'Car',
      category_id: 'c',
      currency: 'BRL',
      amount_borrowed: '40000.0000',
      fees: '1200.0000',
      interest_rate: '1.2000',
      rate_period: 'monthly' as const,
      installment_count: 48,
      installment_amount: '1101.1021',
      first_payment_date: '2026-01-10',
      auto_post: true,
      payment_account_id: 'a',
      notes: null,
      archived: false,
      installments_paid: 2,
    };

    let loans: unknown;
    TestBed.inject(HttpLoanRepository)
      .list()
      .subscribe((r) => (loans = r));
    const listReq = http.expectOne('/api/v1/loans');
    expect(listReq.request.method).toBe('GET');
    listReq.flush([wire]);
    expect((loans as { id: string; installmentsPaid: number }[])[0]).toMatchObject({
      id: 'l',
      installmentsPaid: 2,
      paymentAccountId: 'a',
    });

    TestBed.inject(HttpLoanRepository)
      .create({
        name: 'Car',
        categoryId: 'c',
        currency: 'BRL',
        amountBorrowed: '40000',
        fees: '1200',
        interestRate: '1.2',
        ratePeriod: 'monthly',
        installmentCount: 48,
        firstPaymentDate: '2026-01-10',
        autoPost: true,
        paymentAccountId: 'a',
        archived: false,
      })
      .subscribe();
    const createReq = http.expectOne('/api/v1/loans');
    expect(createReq.request.method).toBe('POST');
    expect(createReq.request.body).toMatchObject({
      name: 'Car',
      category_id: 'c',
      amount_borrowed: '40000',
      rate_period: 'monthly',
      installment_count: 48,
      auto_post: true,
      payment_account_id: 'a',
    });
    expect('installment_amount' in createReq.request.body).toBe(false);
    createReq.flush(wire);

    TestBed.inject(HttpLoanRepository).update('l', { installmentCount: 36 }).subscribe();
    const updateReq = http.expectOne('/api/v1/loans/l');
    expect(updateReq.request.method).toBe('PATCH');
    expect(updateReq.request.body).toEqual({ installment_count: 36 });
    updateReq.flush(wire);

    TestBed.inject(HttpLoanRepository).setArchived('l', true).subscribe();
    const archiveReq = http.expectOne('/api/v1/loans/l/archive');
    expect(archiveReq.request.method).toBe('POST');
    expect(archiveReq.request.body).toEqual({ archived: true });
    archiveReq.flush(wire);

    let payment: unknown;
    TestBed.inject(HttpLoanRepository)
      .recordPayment('l', { amount: '1101.1021', date: '2026-03-10', accountId: 'a' })
      .subscribe((r) => (payment = r));
    const payReq = http.expectOne('/api/v1/loans/l/payments');
    expect(payReq.request.method).toBe('POST');
    expect(payReq.request.body).toEqual({
      amount: '1101.1021',
      date: '2026-03-10',
      account_id: 'a',
      description: null,
    });
    payReq.flush({
      id: 't',
      type: 'expense',
      date: '2026-03-10',
      amount: '1101.1021',
      currency: 'BRL',
      account_id: 'a',
      to_account_id: null,
      category_id: 'c',
      description: 'Car 3/48',
      notes: null,
      recurring_rule_id: null,
      loan_id: 'l',
      conversion: null,
    });
    expect(payment).toMatchObject({ id: 't', loanId: 'l', type: 'expense' });
  });

  it('lists and pays card invoices for an account', () => {
    let invoices: unknown;
    TestBed.inject(HttpCardInvoiceRepository)
      .list('c', { back: 3, ahead: 3 })
      .subscribe((r) => (invoices = r));
    const listReq = http.expectOne((r) => r.url === '/api/v1/accounts/c/invoices');
    expect(listReq.request.method).toBe('GET');
    expect(listReq.request.params.get('months_back')).toBe('3');
    expect(listReq.request.params.get('months_ahead')).toBe('3');
    listReq.flush([
      {
        close_date: '2026-01-20',
        due_date: '2026-01-27',
        period_start: '2025-12-21',
        period_end: '2026-01-20',
        currency: 'BRL',
        total: '120.0000',
        paid: '0.0000',
        remaining: '120.0000',
        status: 'closed',
      },
    ]);
    expect(invoices).toEqual([
      {
        closeDate: '2026-01-20',
        dueDate: '2026-01-27',
        periodStart: '2025-12-21',
        periodEnd: '2026-01-20',
        currency: 'BRL',
        total: '120.0000',
        paid: '0.0000',
        remaining: '120.0000',
        status: 'closed',
      },
    ]);

    let paid: unknown;
    TestBed.inject(HttpCardInvoiceRepository)
      .pay('c', '2026-01-20', { accountId: 'a' })
      .subscribe((r) => (paid = r));
    const payReq = http.expectOne('/api/v1/accounts/c/invoices/2026-01-20/pay');
    expect(payReq.request.method).toBe('POST');
    expect(payReq.request.body).toEqual({
      account_id: 'a',
      date: null,
      amount: null,
      description: null,
    });
    payReq.flush({
      id: 't',
      type: 'transfer',
      date: '2026-01-25',
      amount: '120.0000',
      currency: 'BRL',
      account_id: 'a',
      to_account_id: 'c',
      category_id: null,
      description: 'Card',
      notes: null,
      recurring_rule_id: null,
      loan_id: null,
      card_invoice_close_date: '2026-01-20',
      conversion: null,
    });
    expect(paid).toMatchObject({
      id: 't',
      type: 'transfer',
      cardInvoiceCloseDate: '2026-01-20',
    });
  });

  it('uses agent-chat conversation endpoints and maps the wire shape', () => {
    let detail: unknown;
    let token: unknown;

    TestBed.inject(HttpAgentChatRepository).listConversations().subscribe();
    const listReq = http.expectOne('/api/v1/agents/conversations');
    expect(listReq.request.method).toBe('GET');
    listReq.flush([]);

    TestBed.inject(HttpAgentChatRepository).createConversation('anthropic').subscribe();
    const createReq = http.expectOne('/api/v1/agents/conversations');
    expect(createReq.request.method).toBe('POST');
    expect(createReq.request.body).toEqual({ provider: 'anthropic' });
    createReq.flush({
      id: 'c1',
      title: null,
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      status: 'idle',
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    });

    TestBed.inject(HttpAgentChatRepository)
      .getConversation('c1')
      .subscribe((result) => (detail = result));
    const detailReq = http.expectOne('/api/v1/agents/conversations/c1');
    detailReq.flush({
      id: 'c1',
      title: 'Groceries',
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      status: 'awaiting_confirmation',
      created_at: '2026-01-01',
      updated_at: '2026-01-02',
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          content: '',
          tool_calls: [{ id: 'w1', name: 'create_transaction', arguments: {} }],
          tool_call_id: null,
          tool_name: null,
          is_error: false,
          position: 0,
          created_at: '2026-01-02',
        },
      ],
    });
    expect(detail).toMatchObject({
      id: 'c1',
      status: 'awaiting_confirmation',
      updatedAt: '2026-01-02',
      messages: [{ toolCalls: [{ id: 'w1', name: 'create_transaction', arguments: {} }] }],
    });

    TestBed.inject(HttpAgentChatRepository).deleteConversation('c1').subscribe();
    const deleteReq = http.expectOne('/api/v1/agents/conversations/c1');
    expect(deleteReq.request.method).toBe('DELETE');
    deleteReq.flush(null);

    TestBed.inject(HttpAgentChatRepository)
      .mintMcpToken()
      .subscribe((result) => (token = result));
    const tokenReq = http.expectOne('/api/v1/agents/mcp-token');
    expect(tokenReq.request.method).toBe('POST');
    tokenReq.flush({ token: 'abc', expires_at: '2027-01-01' });
    expect(token).toEqual({ token: 'abc', expiresAt: '2027-01-01' });
  });

  it('reads and writes the custom AI instructions, mapping a null to an empty string', () => {
    let loaded: unknown;
    let saved: unknown;

    TestBed.inject(HttpAgentChatRepository)
      .getInstructions()
      .subscribe((result) => (loaded = result));
    const getReq = http.expectOne('/api/v1/agents/instructions');
    expect(getReq.request.method).toBe('GET');
    getReq.flush({ instructions: null });
    expect(loaded).toBe('');

    TestBed.inject(HttpAgentChatRepository)
      .saveInstructions('Keep answers short.')
      .subscribe((result) => (saved = result));
    const putReq = http.expectOne('/api/v1/agents/instructions');
    expect(putReq.request.method).toBe('PUT');
    expect(putReq.request.body).toEqual({ instructions: 'Keep answers short.' });
    putReq.flush({ instructions: 'Keep answers short.' });
    expect(saved).toBe('Keep answers short.');
  });
});
