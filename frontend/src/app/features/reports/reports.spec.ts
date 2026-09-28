import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, throwError } from 'rxjs';
import { DisplayCurrencyService } from '../../core/display-currency.service';
import { AccountRepository } from '../../data/account.repository';
import { AnalyticsRepository } from '../../data/analytics.repository';
import { CategoryGroupRepository } from '../../data/category-group.repository';
import { ExchangeRateRepository } from '../../data/exchange-rate.repository';
import { MockAccountRepository } from '../../data/mock/mock-account.repository';
import { MockAnalyticsRepository } from '../../data/mock/mock-analytics.repository';
import { MockCategoryGroupRepository } from '../../data/mock/mock-category-group.repository';
import { MockExchangeRateRepository } from '../../data/mock/mock-exchange-rate.repository';
import { MOCK_LATENCY_MS } from '../../data/mock/mock-latency';
import { Account } from '../../domain/models/account';
import { ExchangeRate } from '../../domain/models/exchange-rate';
import { Reports } from './reports';
import { provideTestTransloco, provideTestTranslocoLocale } from '../../../testing/transloco';

describe('Reports', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [Reports, provideTestTransloco()],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideTestTranslocoLocale(),
        { provide: MOCK_LATENCY_MS, useValue: 0 },
        { provide: AccountRepository, useClass: MockAccountRepository },
        { provide: AnalyticsRepository, useClass: MockAnalyticsRepository },
        { provide: CategoryGroupRepository, useClass: MockCategoryGroupRepository },
        { provide: ExchangeRateRepository, useClass: MockExchangeRateRepository },
      ],
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
    expect(incomeExpense.datasets.every((dataset) => dataset.data.some((value) => value > 0))).toBe(
      true,
    );
    expect(netFlow.datasets[0].data.some((value) => value !== 0)).toBe(true);
    expect(balanceTrend.datasets.length).toBeGreaterThan(0);
    expect(
      balanceTrend.datasets.every((dataset) => dataset.data.some((value) => value !== 0)),
    ).toBe(true);
  });

  it('shows one chart tab at a time', async () => {
    const fixture = TestBed.createComponent(Reports);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    const tabs = () => element.querySelectorAll<HTMLButtonElement>('[role="group"] button');

    expect(tabs()[0].getAttribute('aria-pressed')).toBe('true');
    expect(element.querySelectorAll('app-chart')).toHaveLength(2);
    expect(element.querySelector('table')).toBeNull();

    tabs()[1].click();
    fixture.detectChanges();
    expect(element.querySelectorAll('app-chart')).toHaveLength(1);
    expect(element.querySelector('table')).not.toBeNull();

    tabs()[2].click();
    fixture.detectChanges();
    expect(element.querySelectorAll('app-chart')).toHaveLength(1);
    expect(element.querySelector('table')).toBeNull();
  });

  it('edits the custom range in a sheet and applies it only when valid', async () => {
    const fixture = TestBed.createComponent(Reports);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    const select = element.querySelector('select') as HTMLSelectElement;
    const from = element.querySelector('#report-range-from') as HTMLInputElement;
    const to = element.querySelector('#report-range-to') as HTMLInputElement;
    const apply = () =>
      element.querySelector('app-modal button[variant="primary"]') as HTMLButtonElement;
    const type = (input: HTMLInputElement, value: string) => {
      input.value = value;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };

    select.value = 'custom';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(element.querySelector('dialog')?.hasAttribute('open')).toBe(true);
    expect(fixture.componentInstance['period']()).toBe('6m');

    type(from, '2026-05');
    type(to, '2026-02');
    expect(apply().disabled).toBe(true);
    expect(element.querySelector('app-modal [role="alert"]')).not.toBeNull();

    type(to, '2026-07');
    apply().click();
    fixture.detectChanges();
    expect(fixture.componentInstance['period']()).toBe('custom');
    expect(fixture.componentInstance['buckets']().map((bucket) => bucket.key)).toEqual([
      '2026-05',
      '2026-06',
      '2026-07',
    ]);
    expect(element.querySelector('dialog')?.hasAttribute('open')).toBe(false);
  });

  it('restores the previous period when the custom range sheet is dismissed', async () => {
    const fixture = TestBed.createComponent(Reports);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    const select = element.querySelector('select') as HTMLSelectElement;

    select.value = 'custom';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    (element.querySelector('app-modal button[variant="secondary"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(element.querySelector('dialog')?.hasAttribute('open')).toBe(false);
    expect(fixture.componentInstance['period']()).toBe('6m');
    expect(select.value).toBe('6m');
  });

  it('refetches all aggregates when the report period changes', async () => {
    const repository = TestBed.inject(AnalyticsRepository);
    const monthlyTotals = vi.spyOn(repository, 'monthlyTotals');
    const categorySpend = vi.spyOn(repository, 'categorySpend');
    const balanceTrend = vi.spyOn(repository, 'balanceTrend');
    const fixture = TestBed.createComponent(Reports);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance['period'].set('3m');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(monthlyTotals).toHaveBeenCalledTimes(2);
    expect(categorySpend).toHaveBeenCalledTimes(2);
    expect(balanceTrend).toHaveBeenCalledTimes(2);
    expect(balanceTrend.mock.calls[1][0]).toHaveLength(3);
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
    return this.calls === 1 ? throwError(() => new Error('temporary failure')) : super.list();
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
        { provide: AnalyticsRepository, useClass: MockAnalyticsRepository },
        { provide: CategoryGroupRepository, useClass: MockCategoryGroupRepository },
        { provide: ExchangeRateRepository, useClass: MockExchangeRateRepository },
      ],
    }).compileComponents();

    const accountRepository = TestBed.inject(
      AccountRepository,
    ) as RetryableReportsAccountRepository;
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
        { provide: AnalyticsRepository, useClass: MockAnalyticsRepository },
        { provide: CategoryGroupRepository, useClass: MockCategoryGroupRepository },
        { provide: ExchangeRateRepository, useClass: FailingReportsExchangeRateRepository },
      ],
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
