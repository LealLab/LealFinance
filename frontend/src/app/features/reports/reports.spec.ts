import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { provideTranslocoLocale } from '@jsverse/transloco-locale';
import { DisplayCurrencyService } from '../../core/display-currency.service';
import { AccountRepository } from '../../data/account.repository';
import { CategoryRepository } from '../../data/category.repository';
import { ExchangeRateRepository } from '../../data/exchange-rate.repository';
import { MockAccountRepository } from '../../data/mock/mock-account.repository';
import { MockCategoryRepository } from '../../data/mock/mock-category.repository';
import { MockExchangeRateRepository } from '../../data/mock/mock-exchange-rate.repository';
import { MOCK_LATENCY_MS } from '../../data/mock/mock-latency';
import { MockTransactionRepository } from '../../data/mock/mock-transaction.repository';
import { TransactionRepository } from '../../data/transaction.repository';
import { Reports } from './reports';
import ptBR from '../../../../public/i18n/pt-BR.json';

describe('Reports', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [
        Reports,
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
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Relatórios');
    expect(text).toContain('Moradia');
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
