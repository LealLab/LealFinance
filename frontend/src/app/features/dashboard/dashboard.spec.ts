import { ErrorHandler, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { provideTranslocoLocale } from '@jsverse/transloco-locale';
import { Observable, of, Subject } from 'rxjs';
import { Account, AccountBalance } from '../../domain/models/account';
import { AccountRepository } from '../../data/account.repository';
import { Budget } from '../../domain/models/budget';
import { BudgetRepository } from '../../data/budget.repository';
import { Category, CategoryKind } from '../../domain/models/category';
import { CategoryRepository } from '../../data/category.repository';
import { ExchangeRateRepository } from '../../data/exchange-rate.repository';
import { ExchangeRate } from '../../domain/models/exchange-rate';
import { MockAccountRepository } from '../../data/mock/mock-account.repository';
import { MockBudgetRepository } from '../../data/mock/mock-budget.repository';
import { MockCategoryRepository } from '../../data/mock/mock-category.repository';
import { MockExchangeRateRepository } from '../../data/mock/mock-exchange-rate.repository';
import { MOCK_LATENCY_MS } from '../../data/mock/mock-latency';
import { MockTransactionRepository } from '../../data/mock/mock-transaction.repository';
import { Transaction } from '../../domain/models/transaction';
import { TransactionFilters, TransactionRepository } from '../../data/transaction.repository';
import { money } from '../../shared/money/money';
import { monthKey } from '../../domain/calc/dates';
import { Dashboard } from './dashboard';
import ptBR from '../../../../public/i18n/pt-BR.json';

describe('Dashboard', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        Dashboard,
        TranslocoTestingModule.forRoot({
          langs: { 'pt-BR': ptBR },
          translocoConfig: { availableLangs: ['pt-BR'], defaultLang: 'pt-BR' }
        })
      ],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideTranslocoLocale({ defaultLocale: 'pt-BR', defaultCurrency: 'BRL' }),
        { provide: MOCK_LATENCY_MS, useValue: 0 },
        { provide: AccountRepository, useClass: MockAccountRepository },
        { provide: TransactionRepository, useClass: MockTransactionRepository },
        { provide: CategoryRepository, useClass: MockCategoryRepository },
        { provide: BudgetRepository, useClass: MockBudgetRepository },
        { provide: ExchangeRateRepository, useClass: MockExchangeRateRepository }
      ]
    }).compileComponents();
  });

  it('renders the pt-BR title from the translation file', async () => {
    const fixture = TestBed.createComponent(Dashboard);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Painel');
  });

  it('renders stat tiles, the fallback-rate warning, and the seeded account summary', async () => {
    const fixture = TestBed.createComponent(Dashboard);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Patrimônio líquido');
    // The EUR investment account (see data/mock/fixtures.ts) has no known
    // rate in the mock exchange-rate repository on purpose, to exercise
    // this warning on a real screen.
    expect(text).toContain('Taxa de câmbio indisponível');
    expect(text).toContain('Conta Corrente');
  });

  it('colors balances by sign and transfers blue', () => {
    const fixture = TestBed.createComponent(Dashboard);
    const component = fixture.componentInstance;

    expect(component['amountClass'](money('-1', 'BRL'))).toBe('text-negative');
    expect(component['amountClass'](money('1', 'BRL'))).toBe('text-positive');
    expect(component['amountClass'](money('0', 'BRL'))).toBe('text-content-primary');
    expect(component['transactionClass']({ type: 'transfer', amount: '10', currency: 'BRL' })).toBe(
      'text-accent',
    );
  });

  it('navigates to /exchange when the fallback-rate warning action is clicked', async () => {
    const fixture = TestBed.createComponent(Dashboard);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const button = Array.from(fixture.nativeElement.querySelectorAll('button')).find((el) =>
      (el as HTMLButtonElement).textContent?.includes('Definir taxa')
    ) as HTMLButtonElement | undefined;
    button?.click();

    expect(navigateSpy).toHaveBeenCalledWith(['/exchange']);
  });
});

/**
 * A real login always sees this race: accounts/transactions/budgets/
 * categories resolve first, and the exchange-rate fetch for any foreign
 * account currency can only even be *issued* once accountsResource has
 * resolved (see dashboard.ts's `accountCurrencies` -> `displayConverter`
 * chain) - so there is always a window where every other resource is
 * settled and the rate list is still empty. This repository holds each
 * `getRate` call open indefinitely so the test can park the dashboard in
 * exactly that window before choosing to resolve it, instead of racing a
 * real timer.
 */
class DelayedExchangeRateRepository extends ExchangeRateRepository {
  readonly pending: { baseCode: string; quoteCode: string; subject: Subject<ExchangeRate> }[] = [];

  getRate(baseCode: string, quoteCode: string): Observable<ExchangeRate> {
    const subject = new Subject<ExchangeRate>();
    this.pending.push({ baseCode, quoteCode, subject });
    return subject.asObservable();
  }

  resolveAll(): void {
    for (const { baseCode, quoteCode, subject } of this.pending) {
      subject.next({ baseCode, quoteCode, rate: '5.2', isFallback: false, source: 'quote', asOf: '2026-01-01' });
      subject.complete();
    }
  }
}

class CapturingErrorHandler implements ErrorHandler {
  readonly errors: unknown[] = [];
  handleError(error: unknown): void {
    this.errors.push(error);
  }
}

describe('Dashboard - exchange rates still loading on first render', () => {
  let delayedRates: DelayedExchangeRateRepository;
  let errorHandler: CapturingErrorHandler;

  beforeEach(async () => {
    delayedRates = new DelayedExchangeRateRepository();
    errorHandler = new CapturingErrorHandler();

    await TestBed.configureTestingModule({
      imports: [
        Dashboard,
        TranslocoTestingModule.forRoot({
          langs: { 'pt-BR': ptBR },
          translocoConfig: { availableLangs: ['pt-BR'], defaultLang: 'pt-BR' }
        })
      ],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideTranslocoLocale({ defaultLocale: 'pt-BR', defaultCurrency: 'BRL' }),
        { provide: MOCK_LATENCY_MS, useValue: 0 },
        { provide: AccountRepository, useClass: MockAccountRepository },
        { provide: TransactionRepository, useClass: MockTransactionRepository },
        { provide: CategoryRepository, useClass: MockCategoryRepository },
        { provide: BudgetRepository, useClass: MockBudgetRepository },
        { provide: ExchangeRateRepository, useValue: delayedRates },
        { provide: ErrorHandler, useValue: errorHandler }
      ]
    }).compileComponents();
  });

  // Deliberately not fixture.whenStable(): the delayed exchange-rate
  // request is left open on purpose (see DelayedExchangeRateRepository),
  // and rxResource registers a pending task for as long as a resource is
  // loading - whenStable() would hang forever waiting for a request this
  // test never intends to resolve yet. Pumping microtasks directly lets
  // the other (synchronously-resolving mock) resources settle without
  // waiting on that one.
  async function flush(fixture: ComponentFixture<Dashboard>, times = 5): Promise<void> {
    for (let i = 0; i < times; i++) {
      await Promise.resolve();
      fixture.detectChanges();
    }
  }

  it('renders a loading state instead of crashing while the rate is still in flight, then the real figures once it arrives', async () => {
    const fixture = TestBed.createComponent(Dashboard);
    const component = fixture.componentInstance;
    fixture.detectChanges();
    await flush(fixture);

    // Every other resource (accounts, transactions, budgets, categories)
    // is settled by now, but the rate request this unlocked is still
    // pending - the exact window that used to throw "Currency mismatch:
    // cannot combine BRL with EUR" out of the netWorth/monthTotals/
    // categoryChart/budgetPreview computeds.
    expect(delayedRates.pending.length).toBeGreaterThan(0);
    expect(component['ratesReady']()).toBe(false);
    expect(errorHandler.errors).toEqual([]);
    expect((fixture.nativeElement.textContent as string)).not.toContain('Patrimônio líquido');

    delayedRates.resolveAll();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(errorHandler.errors).toEqual([]);
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Patrimônio líquido');
    expect(text).toContain('Conta Corrente');
  });
});

/**
 * A second, independent race with the same symptom: `budgetProgress`
 * converts into each *budget's own* currency, not the display currency
 * (see domain/calc/budgets.ts) - so a budgeted category that catches a
 * transaction in some third currency needs a rate for that (transaction,
 * budget) pair specifically, which is never one of the
 * (account-currency, display-currency) pairs the dashboard's main
 * `converter` fetches. Reproduced live against the dev seed data
 * (BRL display, a USD budget, a EUR transaction filed under it) as
 * `Currency mismatch: cannot combine USD with EUR` thrown from
 * budgetProgress -> sum -> add. These fixtures/stubs (not the shared
 * mock repositories, which only ever exercise BRL budgets) are the
 * minimal shape that reproduces it.
 */
class StubAccountRepository extends AccountRepository {
  list(): Observable<Account[]> {
    return of([
      { id: 'acc-brl', name: 'Checking', type: 'checking', currency: 'BRL', openingBalance: '0', archived: false },
      { id: 'acc-eur', name: 'Investments', type: 'investment', currency: 'EUR', openingBalance: '0', archived: false }
    ]);
  }
  balances(): Observable<AccountBalance[]> {
    return of([
      { accountId: 'acc-brl', currency: 'BRL', balance: '1000' },
      { accountId: 'acc-eur', currency: 'EUR', balance: '500' }
    ]);
  }
  get(): Observable<Account | undefined> {
    throw new Error('not used by this spec');
  }
  create(): Observable<Account> {
    throw new Error('not used by this spec');
  }
  update(): Observable<Account> {
    throw new Error('not used by this spec');
  }
  setArchived(): Observable<Account> {
    throw new Error('not used by this spec');
  }
}

class StubTransactionRepository extends TransactionRepository {
  list(filters?: TransactionFilters): Observable<Transaction[]> {
    void filters;
    const today = new Date().toISOString().slice(0, 10);
    const eurExpenseUnderUsdBudget: Transaction = {
      id: 'tx-1',
      type: 'expense',
      date: today,
      amount: '100',
      currency: 'EUR',
      accountId: 'acc-eur',
      categoryId: 'cat-groceries',
      description: 'Supermarket'
    };
    return of([eurExpenseUnderUsdBudget]);
  }
  get(): Observable<Transaction | undefined> {
    throw new Error('not used by this spec');
  }
  create(): Observable<Transaction> {
    throw new Error('not used by this spec');
  }
  update(): Observable<Transaction> {
    throw new Error('not used by this spec');
  }
  delete(): Observable<void> {
    throw new Error('not used by this spec');
  }
  importPreview(): Observable<never> {
    throw new Error('not used by this spec');
  }
  importCommit(): Observable<number> {
    throw new Error('not used by this spec');
  }
}

class StubCategoryRepository extends CategoryRepository {
  list(): Observable<Category[]> {
    return of([
      { id: 'cat-groceries', name: 'Groceries', kind: 'expense' as CategoryKind, color: '#000', icon: 'tag', archived: false, position: 0 }
    ]);
  }
  create(): Observable<Category> {
    throw new Error('not used by this spec');
  }
  update(): Observable<Category> {
    throw new Error('not used by this spec');
  }
  setArchived(): Observable<Category> {
    throw new Error('not used by this spec');
  }
  delete(): Observable<void> {
    throw new Error('not used by this spec');
  }
  reorder(): Observable<void> {
    throw new Error('not used by this spec');
  }
}

class StubBudgetRepository extends BudgetRepository {
  list(): Observable<Budget[]> {
    return of([
      { id: 'budget-1', categoryId: 'cat-groceries', month: monthKey(new Date().toISOString()), amount: '200', currency: 'USD' }
    ]);
  }
  upsert(): Observable<Budget> {
    throw new Error('not used by this spec');
  }
  delete(): Observable<void> {
    throw new Error('not used by this spec');
  }
}

/** Serves every (base, quote) pair asked, including the EUR->USD one the bug used to skip fetching entirely. */
class StubExchangeRateRepository extends ExchangeRateRepository {
  getRate(baseCode: string, quoteCode: string): Observable<ExchangeRate> {
    return of({ baseCode, quoteCode, rate: '1.1', isFallback: false, source: 'quote', asOf: '2026-01-01' });
  }
}

describe('Dashboard - a budget in one currency catching a transaction in another', () => {
  let errorHandler: CapturingErrorHandler;

  beforeEach(async () => {
    // DisplayCurrencyService reads its initial value from localStorage,
    // defaulting to USD (see display-currency.service.ts) - pinning it to
    // BRL here, distinct from both the EUR transaction and the USD budget,
    // is what makes this test actually exercise two independent rate
    // fetches instead of one of them accidentally lining up with the
    // budget's currency by coincidence.
    localStorage.setItem('lealfinance.displayCurrency', 'BRL');
    errorHandler = new CapturingErrorHandler();
    await TestBed.configureTestingModule({
      imports: [
        Dashboard,
        TranslocoTestingModule.forRoot({
          langs: { 'pt-BR': ptBR },
          translocoConfig: { availableLangs: ['pt-BR'], defaultLang: 'pt-BR' }
        })
      ],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideTranslocoLocale({ defaultLocale: 'pt-BR', defaultCurrency: 'BRL' }),
        { provide: AccountRepository, useClass: StubAccountRepository },
        { provide: TransactionRepository, useClass: StubTransactionRepository },
        { provide: CategoryRepository, useClass: StubCategoryRepository },
        { provide: BudgetRepository, useClass: StubBudgetRepository },
        { provide: ExchangeRateRepository, useClass: StubExchangeRateRepository },
        { provide: ErrorHandler, useValue: errorHandler }
      ]
    }).compileComponents();
  });

  afterEach(() => {
    localStorage.removeItem('lealfinance.displayCurrency');
  });

  it('fetches a rate for the (transaction currency, budget currency) pair and renders the budget row without crashing', async () => {
    const fixture = TestBed.createComponent(Dashboard);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(errorHandler.errors).toEqual([]);
    const component = fixture.componentInstance;
    expect(component['budgetRatesReady']()).toBe(true);
    const preview = component['budgetPreview']() as { categoryName: string; spent: { amount: string; currency: string } }[];
    expect(preview).toHaveLength(1);
    expect(preview[0].categoryName).toBe('Groceries');
    // 100 EUR * 1.1 = 110 USD, matching the budget's own currency (USD) -
    // not the display currency (BRL) and not left unconverted (EUR).
    expect(preview[0].spent).toEqual(money('110', 'USD'));
  });
});
