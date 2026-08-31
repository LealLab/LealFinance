import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { DisplayCurrencyService } from '../../core/display-currency.service';
import { BudgetRepository } from '../../data/budget.repository';
import { BudgetPlanRepository } from '../../data/budget-plan.repository';
import { CategoryGroupRepository } from '../../data/category-group.repository';
import { CategoryRepository } from '../../data/category.repository';
import { ExchangeRateRepository } from '../../data/exchange-rate.repository';
import { MockBudgetRepository } from '../../data/mock/mock-budget.repository';
import { MockBudgetPlanRepository } from '../../data/mock/mock-budget-plan.repository';
import { MockCategoryRepository } from '../../data/mock/mock-category.repository';
import { MockCategoryGroupRepository } from '../../data/mock/mock-category-group.repository';
import { MockExchangeRateRepository } from '../../data/mock/mock-exchange-rate.repository';
import { MOCK_LATENCY_MS } from '../../data/mock/mock-latency';
import { MockTransactionRepository } from '../../data/mock/mock-transaction.repository';
import { TransactionRepository } from '../../data/transaction.repository';
import { money } from '../../shared/money/money';
import { Budgets } from './budgets';
import { provideTestTransloco, provideTestTranslocoLocale } from '../../../testing/transloco';

describe('Budgets', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [
        Budgets,
        provideTestTransloco(),
      ],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideTestTranslocoLocale(),
        { provide: MOCK_LATENCY_MS, useValue: 0 },
        { provide: BudgetRepository, useClass: MockBudgetRepository },
        { provide: BudgetPlanRepository, useClass: MockBudgetPlanRepository },
        { provide: CategoryGroupRepository, useClass: MockCategoryGroupRepository },
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
    // Fixtures deliberately size Alimentação over budget and leave
    // Saúde/Educação unbudgeted this month (see data/mock/fixtures.ts) -
    // asserting on that is a real regression check, not just a smoke test.
    const component = fixture.componentInstance;
    expect(component['budgetRows']().some((row) => row.state === 'over')).toBe(true);
    expect(component['unbudgetedRows']().length).toBeGreaterThan(0);
    expect(
      component['allocationRows']().find((row) => row.group.id === 'group-housing')?.percentage,
    ).toBe('44.44');
  });

  it('colors budget totals by semantic direction and leaves zero neutral', () => {
    const fixture = TestBed.createComponent(Budgets);
    const component = fixture.componentInstance;

    expect(component['valueTone'](money('1', 'BRL'))).toBe('positive');
    expect(component['valueTone'](money('1', 'BRL'), true)).toBe('negative');
    expect(component['valueTone'](money('-1', 'BRL'))).toBe('negative');
    expect(component['valueTone'](money('0', 'BRL'))).toBe('default');
  });

  it('sets a budget for an unbudgeted category end-to-end', async () => {
    const fixture = TestBed.createComponent(Budgets);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    // No stable hook; queried by a Transloco-resolved label, not hardcoded copy.
    const setBudgetLabel = TestBed.inject(TranslocoService).translate('budgets.unbudgeted.setBudget');
    const setBudgetButton = Array.from(el.querySelectorAll('button')).find((b) =>
      b.textContent?.includes(setBudgetLabel),
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
    expect(
      fixture.componentInstance['budgetRows']().some((row) => row.budget.amount === '300'),
    ).toBe(true);
  });

  it('warns and does not save when percentage allocations exceed 100%', async () => {
    const fixture = TestBed.createComponent(Budgets);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      setAllocation(groupId: string, value: string): void;
      savePlanner(): void;
    };
    component.setAllocation('group-health', '81');
    component.setAllocation('group-education', '20');
    fixture.detectChanges();

    expect(fixture.componentInstance['totalPercentage']()).toBeGreaterThan(100);

    component.savePlanner();
    fixture.detectChanges();

    expect(fixture.componentInstance['plannerError']()).toBe('budgets.planner.errors.total');
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
