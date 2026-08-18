import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { provideTranslocoLocale } from '@jsverse/transloco-locale';
import { DisplayCurrencyService } from '../../core/display-currency.service';
import { BudgetRepository } from '../../data/budget.repository';
import { BudgetPlanRepository } from '../../data/budget-plan.repository';
import { CategoryRepository } from '../../data/category.repository';
import { ExchangeRateRepository } from '../../data/exchange-rate.repository';
import { MockBudgetRepository } from '../../data/mock/mock-budget.repository';
import { MockBudgetPlanRepository } from '../../data/mock/mock-budget-plan.repository';
import { MockCategoryRepository } from '../../data/mock/mock-category.repository';
import { MockExchangeRateRepository } from '../../data/mock/mock-exchange-rate.repository';
import { MOCK_LATENCY_MS } from '../../data/mock/mock-latency';
import { MockTransactionRepository } from '../../data/mock/mock-transaction.repository';
import { TransactionRepository } from '../../data/transaction.repository';
import { Budgets } from './budgets';
import ptBR from '../../../../public/i18n/pt-BR.json';

describe('Budgets', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [
        Budgets,
        TranslocoTestingModule.forRoot({
          langs: { 'pt-BR': ptBR },
          translocoConfig: { availableLangs: ['pt-BR'], defaultLang: 'pt-BR' },
        }),
      ],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideTranslocoLocale({ defaultLocale: 'pt-BR', defaultCurrency: 'BRL' }),
        { provide: MOCK_LATENCY_MS, useValue: 0 },
        { provide: BudgetRepository, useClass: MockBudgetRepository },
        { provide: BudgetPlanRepository, useClass: MockBudgetPlanRepository },
        { provide: CategoryRepository, useClass: MockCategoryRepository },
        { provide: ExchangeRateRepository, useClass: MockExchangeRateRepository },
        { provide: TransactionRepository, useClass: MockTransactionRepository },
      ],
    }).compileComponents();
  });

  it('renders the current month budgets (under/near/over states and an unbudgeted section) without error', async () => {
    const fixture = TestBed.createComponent(Budgets);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance).toBeTruthy();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Orçamentos');
    // Fixtures deliberately size Alimentação over budget and leave
    // Saúde/Educação unbudgeted this month (see data/mock/fixtures.ts) -
    // asserting on that is a real regression check, not just a smoke test.
    expect(text).toContain('Estourado');
    expect(text).toContain('Gastos sem orçamento definido');
    expect(text).toContain('44.44%');
  });

  it('sets a budget for an unbudgeted category end-to-end', async () => {
    const fixture = TestBed.createComponent(Budgets);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const setBudgetButton = Array.from(el.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Definir orçamento'),
    );
    expect(setBudgetButton).toBeTruthy();
    setBudgetButton!.click();
    fixture.detectChanges();

    const dialog = el.querySelector('dialog') as HTMLDialogElement;
    expect(dialog.open).toBe(true);

    const amountInput = dialog.querySelector('#budget-amount') as HTMLInputElement;
    amountInput.value = '300';
    amountInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const form = dialog.querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(dialog.open).toBe(false);
    expect(el.textContent).toContain('300,00');
  });

  it('warns and does not save when percentage allocations exceed 100%', async () => {
    const fixture = TestBed.createComponent(Budgets);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      setAllocation(categoryId: string, value: string): void;
      savePlanner(): void;
    };
    component.setAllocation('cat-health', '81');
    component.setAllocation('cat-education', '20');
    fixture.detectChanges();

    const total = fixture.nativeElement.querySelector('h2') as HTMLElement;
    expect(total.className).toContain('text-negative');

    component.savePlanner();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'A distribuição não pode ultrapassar 100%.',
    );
  });

  it('converts budget aggregates when the display currency changes', async () => {
    const displayCurrency = TestBed.inject(DisplayCurrencyService);
    displayCurrency.setCurrency('BRL');
    const fixture = TestBed.createComponent(Budgets);
    fixture.detectChanges();
    await fixture.whenStable();

    displayCurrency.setCurrency('USD');
    fixture.detectChanges();
    await fixture.whenStable();

    const totals = fixture.componentInstance['totals']();
    expect(totals.budgeted.currency).toBe('USD');
    expect(totals.spent.currency).toBe('USD');
    expect(totals.remaining.currency).toBe('USD');
    expect(
      fixture.componentInstance['budgetRows']().every(
        (row) => row.budgeted.currency === 'USD' && row.spent.currency === 'USD',
      ),
    ).toBe(true);
    expect(
      fixture.componentInstance['unbudgetedRows']().every((row) => row.spent.currency === 'USD'),
    ).toBe(true);
  });
});
