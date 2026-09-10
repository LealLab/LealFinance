import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { AccountRepository } from '../../data/account.repository';
import { CardInvoiceRepository } from '../../data/card-invoice.repository';
import { ExchangeRateRepository } from '../../data/exchange-rate.repository';
import { LoanRepository } from '../../data/loan.repository';
import { RecurringRuleRepository } from '../../data/recurring-rule.repository';
import { TransactionRepository } from '../../data/transaction.repository';
import { Account } from '../../domain/models/account';
import { CardInvoice } from '../../domain/models/card-invoice';
import { ExchangeRate } from '../../domain/models/exchange-rate';
import { Loan } from '../../domain/models/loan';
import { RecurringRule } from '../../domain/models/recurring';
import { addDays, formatIsoDate, parseIsoDate, todayIso } from '../../domain/calc/dates';
import { Transaction } from '../../domain/models/transaction';
import { Agenda } from './agenda';
import { provideTestTransloco, provideTestTranslocoLocale } from '../../../testing/transloco';

function dateAfter(days: number): string {
  return formatIsoDate(addDays(parseIsoDate(todayIso()), days));
}

function account(id: string, type: Account['type'], currency = 'BRL'): Account {
  return {
    id,
    name: id === 'card' ? 'Card' : 'Checking',
    type,
    currency,
    openingBalance: '0',
    archived: false,
  };
}

function rule(): RecurringRule {
  return {
    id: 'rule-salary',
    frequency: 'monthly',
    interval: 1,
    startDate: todayIso(),
    // Cap the rule before the next monthly occurrence so the 30-day window
    // holds exactly one projected occurrence (today's).
    endDate: dateAfter(20),
    template: {
      type: 'income',
      amount: '100.00',
      currency: 'BRL',
      accountId: 'checking',
      description: 'Salary',
    },
  };
}

function invoice(): CardInvoice {
  return {
    closeDate: dateAfter(-10),
    dueDate: dateAfter(5),
    periodStart: dateAfter(-40),
    periodEnd: dateAfter(-10),
    currency: 'BRL',
    total: '70.00',
    paid: '0.00',
    remaining: '70.00',
    status: 'closed',
  };
}

function loan(): Loan {
  return {
    id: 'loan-car',
    name: 'Car loan',
    categoryId: 'category',
    currency: 'BRL',
    amountBorrowed: '500.00',
    fees: '0.00',
    interestRate: '0.00',
    ratePeriod: 'monthly',
    installmentCount: 1,
    installmentAmount: '500.00',
    firstPaymentDate: dateAfter(10),
    autoPost: false,
    archived: false,
    installmentsPaid: 0,
  };
}

function repositories(data: {
  accounts?: Observable<Account[]>;
  recurringRules?: Observable<RecurringRule[]>;
  invoices?: Observable<CardInvoice[]>;
  loans?: Observable<Loan[]>;
  transactions?: Observable<Transaction[]>;
  rates?: Observable<ExchangeRate>;
}) {
  const accountsRepository = {
    list: vi.fn(
      () => data.accounts ?? of([account('checking', 'checking'), account('card', 'credit_card')]),
    ),
  };
  const recurringRulesRepository = { list: vi.fn(() => data.recurringRules ?? of([rule()])) };
  const cardInvoiceRepository = { list: vi.fn(() => data.invoices ?? of([invoice()])) };
  const loanRepository = { list: vi.fn(() => data.loans ?? of([loan()])) };
  const transactionRepository = { list: vi.fn(() => data.transactions ?? of([])) };
  const exchangeRateRepository = {
    getRate: vi.fn(
      (baseCode: string, quoteCode: string) => data.rates ?? of(rate(baseCode, quoteCode)),
    ),
  };
  return {
    providers: [
      { provide: AccountRepository, useValue: accountsRepository },
      { provide: CardInvoiceRepository, useValue: cardInvoiceRepository },
      { provide: LoanRepository, useValue: loanRepository },
      { provide: RecurringRuleRepository, useValue: recurringRulesRepository },
      { provide: TransactionRepository, useValue: transactionRepository },
      { provide: ExchangeRateRepository, useValue: exchangeRateRepository },
    ],
    cardInvoiceRepository,
  };
}

function rate(baseCode: string, quoteCode: string) {
  return {
    baseCode,
    quoteCode,
    rate: '1',
    isFallback: false,
    source: 'quote' as const,
    asOf: todayIso(),
  };
}

async function setup(data: Parameters<typeof repositories>[0] = {}) {
  const repos = repositories(data);
  await TestBed.configureTestingModule({
    imports: [Agenda, provideTestTransloco()],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      provideTestTranslocoLocale(),
      ...repos.providers,
    ],
  }).compileComponents();
  return repos;
}

async function render() {
  const fixture = TestBed.createComponent(Agenda);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

describe('Agenda', () => {
  beforeEach(() => localStorage.clear());

  it('renders recurrences, card invoices, and loan installments', async () => {
    const repos = await setup();
    const fixture = await render();

    expect(fixture.nativeElement.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(repos.cardInvoiceRepository.list).toHaveBeenCalledWith('card', { back: 0, ahead: 2 });
    expect(fixture.componentInstance['agenda']()!.entries.map((entry) => entry.source)).toEqual([
      'recurrence',
      'invoice',
      'installment',
    ]);
  });

  it('shows the empty state when nothing is due', async () => {
    await setup({
      accounts: of([]),
      recurringRules: of([]),
      invoices: of([]),
      loans: of([]),
      transactions: of([]),
    });
    const fixture = await render();

    expect(fixture.nativeElement.querySelector('app-empty-state')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('tbody')).toBeNull();
  });
});

describe('Agenda errors and rates', () => {
  beforeEach(() => localStorage.clear());

  it('shows a load error when a data resource fails', async () => {
    await setup({ accounts: throwError(() => new Error('temporary failure')) });
    const fixture = await render();

    expect(fixture.nativeElement.querySelector('app-load-error')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-empty-state')).toBeNull();
  });

  it('shows the exchange-rate warning when a fallback rate is used', async () => {
    const foreignAccount = account('checking', 'checking', 'EUR');
    const foreignRule = {
      ...rule(),
      template: { ...rule().template, currency: 'EUR' },
    };
    await setup({
      accounts: of([foreignAccount]),
      recurringRules: of([foreignRule]),
      invoices: of([]),
      loans: of([]),
      rates: of({ ...rate('EUR', 'USD'), isFallback: true, source: 'fallback' as const }),
    });
    const fixture = await render();

    expect(fixture.nativeElement.querySelector('app-exchange-rate-warning')).not.toBeNull();
  });
});
