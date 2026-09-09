import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, throwError } from 'rxjs';
import { DisplayCurrencyService } from '../../core/display-currency.service';
import { AccountRepository } from '../../data/account.repository';
import { CategoryGroupRepository } from '../../data/category-group.repository';
import { CategoryRepository } from '../../data/category.repository';
import { ExchangeRateRepository } from '../../data/exchange-rate.repository';
import { MockAccountRepository } from '../../data/mock/mock-account.repository';
import { MockCategoryRepository } from '../../data/mock/mock-category.repository';
import { MockCategoryGroupRepository } from '../../data/mock/mock-category-group.repository';
import { MockExchangeRateRepository } from '../../data/mock/mock-exchange-rate.repository';
import { MOCK_LATENCY_MS } from '../../data/mock/mock-latency';
import { MockTransactionRepository } from '../../data/mock/mock-transaction.repository';
import { TransactionRepository } from '../../data/transaction.repository';
import { Account } from '../../domain/models/account';
import { ExchangeRate } from '../../domain/models/exchange-rate';
import { Reports } from './reports';
import { provideTestTransloco, provideTestTranslocoLocale } from '../../../testing/transloco';

describe('Reports', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [
        Reports,
        provideTestTransloco()
      ],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideTestTranslocoLocale(),
        { provide: MOCK_LATENCY_MS, useValue: 0 },
        { provide: AccountRepository, useClass: MockAccountRepository },
        { provide: TransactionRepository, useClass: MockTransactionRepository },
        { provide: CategoryRepository, useClass: MockCategoryRepository },
        { provide: CategoryGroupRepository, useClass: MockCategoryGroupRepository },
        { provide: ExchangeRateRepository, useClass: MockExchangeRateRepository }
      ]
    }).compileComponents();
  });

  it('renders the default 6-month report with charts and the category table', async () => {
    const fixture = TestBed.createComponent(Reports);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance).toBeTruthy();
    expect(fixture.nativeElement.querySelectorAll('canvas').length).toBeGreaterThan(0);
  });

  it('builds populated datasets for every report chart after loading', async () => {
    const fixture = TestBed.createComponent(Reports);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const incomeExpense = component['incomeExpenseChart']();
    const netFlow = component['netFlowChart']();
    const balanceTrend = component['balanceTrendChart']();

    expect(incomeExpense.labels).toHaveLength(6);
    expect(incomeExpense.datasets.every((dataset) => dataset.data.some((value) => value > 0))).toBe(true);
    expect(netFlow.datasets[0].data.some((value) => value !== 0)).toBe(true);
    expect(balanceTrend.datasets.length).toBeGreaterThan(0);
    expect(balanceTrend.datasets.every((dataset) => dataset.data.some((value) => value !== 0))).toBe(true);
  });

  it('switches to a custom period and shows the date inputs', async () => {
    const fixture = TestBed.createComponent(Reports);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    fixture.componentInstance['period'].set('custom');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('input[type="month"]').length).toBe(2);
  });

  it('converts report totals when the display currency changes', async () => {
    const displayCurrency = TestBed.inject(DisplayCurrencyService);
    displayCurrency.setCurrency('BRL');
    const fixture = TestBed.createComponent(Reports);
    fixture.detectChanges();
    await fixture.whenStable();

    displayCurrency.setCurrency('USD');
    fixture.detectChanges();
    await fixture.whenStable();

    const rows = fixture.componentInstance['categoryTable']();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.total.currency === 'USD')).toBe(true);
    const foreignTrend = fixture.componentInstance['balanceTrendChart']().datasets.find(
      (dataset) => dataset.label === 'Investimentos (Europa)',
    );
    expect(foreignTrend?.data.at(-1)).toBeGreaterThan(0);
  });
});

class RetryableReportsAccountRepository extends MockAccountRepository {
  calls = 0;

  override list(): Observable<Account[]> {
    this.calls++;
    return this.calls === 1
      ? throwError(() => new Error('temporary failure'))
      : super.list();
  }
}

class FailingReportsExchangeRateRepository extends MockExchangeRateRepository {
  override getRate(baseCode: string, quoteCode: string): Observable<ExchangeRate> {
    void baseCode;
    void quoteCode;
    return throwError(() => new Error('rate unavailable'));
  }
}

describe('Reports - load failures', () => {
  beforeEach(() => localStorage.clear());

  it('shows a data error instead of the empty state and retries the failed resource', async () => {
    await TestBed.configureTestingModule({
      imports: [Reports, provideTestTransloco()],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideTestTranslocoLocale(),
        { provide: MOCK_LATENCY_MS, useValue: 0 },
        { provide: AccountRepository, useClass: RetryableReportsAccountRepository },
        { provide: TransactionRepository, useClass: MockTransactionRepository },
        { provide: CategoryRepository, useClass: MockCategoryRepository },
        { provide: CategoryGroupRepository, useClass: MockCategoryGroupRepository },
        { provide: ExchangeRateRepository, useClass: MockExchangeRateRepository }
      ]
    }).compileComponents();

    const accountRepository = TestBed.inject(AccountRepository) as RetryableReportsAccountRepository;
    const fixture = TestBed.createComponent(Reports);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component['dataError']()).toBe(true);
    expect(fixture.nativeElement.querySelector('app-load-error')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-empty-state')).toBeNull();

    (fixture.nativeElement.querySelector('app-load-error button') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(accountRepository.calls).toBe(2);
    expect(component['dataError']()).toBe(false);
    expect(fixture.nativeElement.querySelector('canvas')).not.toBeNull();
  });

  it('shows an error when exchange rates fail instead of an endless skeleton', async () => {
    await TestBed.configureTestingModule({
      imports: [Reports, provideTestTransloco()],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideTestTranslocoLocale(),
        { provide: MOCK_LATENCY_MS, useValue: 0 },
        { provide: AccountRepository, useClass: MockAccountRepository },
        { provide: TransactionRepository, useClass: MockTransactionRepository },
        { provide: CategoryRepository, useClass: MockCategoryRepository },
        { provide: CategoryGroupRepository, useClass: MockCategoryGroupRepository },
        { provide: ExchangeRateRepository, useClass: FailingReportsExchangeRateRepository }
      ]
    }).compileComponents();

    const fixture = TestBed.createComponent(Reports);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance['ratesFailed']()).toBe(true);
    expect(fixture.nativeElement.querySelector('app-load-error')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-skeleton')).toBeNull();
  });
});
