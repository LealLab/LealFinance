import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, of } from 'rxjs';
import { ConfirmService } from '../../core/confirm.service';
import { AccountRepository } from '../../data/account.repository';
import { BudgetRepository } from '../../data/budget.repository';
import { CategoryRepository } from '../../data/category.repository';
import { CategoryGroupRepository } from '../../data/category-group.repository';
import { ExchangeRateRepository } from '../../data/exchange-rate.repository';
import { InstitutionRepository } from '../../data/institution.repository';
import { MockAccountRepository } from '../../data/mock/mock-account.repository';
import { MockBudgetRepository } from '../../data/mock/mock-budget.repository';
import { MockCategoryRepository } from '../../data/mock/mock-category.repository';
import { MockCategoryGroupRepository } from '../../data/mock/mock-category-group.repository';
import { MockExchangeRateRepository } from '../../data/mock/mock-exchange-rate.repository';
import { MockInstitutionRepository } from '../../data/mock/mock-institution.repository';
import { MOCK_LATENCY_MS } from '../../data/mock/mock-latency';
import { MockRecurringRuleRepository } from '../../data/mock/mock-recurring-rule.repository';
import { MockTransactionRepository } from '../../data/mock/mock-transaction.repository';
import { formatIsoDate } from '../../domain/calc/dates';
import { ProjectedTransaction, RecurringRule } from '../../domain/models/recurring';
import { Transaction } from '../../domain/models/transaction';
import { RecurringRuleRepository } from '../../data/recurring-rule.repository';
import { Page } from '../../core/api-client';
import { ImportPreview, TransactionRepository } from '../../data/transaction.repository';
import { Transactions } from './transactions';
import { provideTestTransloco, provideTestTranslocoLocale } from '../../../testing/transloco';

describe('Transactions', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        Transactions,
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
        { provide: BudgetRepository, useClass: MockBudgetRepository },
        { provide: RecurringRuleRepository, useClass: MockRecurringRuleRepository },
        { provide: InstitutionRepository, useClass: MockInstitutionRepository },
        { provide: ExchangeRateRepository, useClass: MockExchangeRateRepository }
      ]
    }).compileComponents();
  });

  it('renders the seeded transactions list without error', async () => {
    const fixture = TestBed.createComponent(Transactions);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance['rows']().length).toBeGreaterThan(0);
  });

  it('uses blue for transfers and the neutral color for zero amounts', async () => {
    const fixture = TestBed.createComponent(Transactions);
    const component = fixture.componentInstance;

    expect(component['rowToneClass']({ type: 'transfer', amount: '10', currency: 'BRL' })).toBe(
      'text-accent',
    );
    expect(component['rowToneClass']({ type: 'expense', amount: '0', currency: 'BRL' })).toBe(
      'text-content-primary',
    );
  });

  it('switches to the recurring rules tab', async () => {
    const fixture = TestBed.createComponent(Transactions);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance['tab'].set('recurring');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance['tab']()).toBe('recurring');
  });

  it('creates a new expense transaction end-to-end through the modal', async () => {
    const fixture = TestBed.createComponent(Transactions);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const newButton = el.querySelector<HTMLButtonElement>('app-page-header button[variant="primary"]')!;
    newButton!.click();
    fixture.detectChanges();

    const dialog = el.querySelector('dialog') as HTMLDialogElement;
    expect(dialog.open).toBe(true);

    const accountSelect = dialog.querySelector('#tx-account') as HTMLSelectElement;
    const firstRealAccountOption = accountSelect.options[1];
    accountSelect.value = firstRealAccountOption.value;
    accountSelect.dispatchEvent(new Event('change'));

    const categorySelect = dialog.querySelector('#tx-category') as HTMLSelectElement;
    const firstRealCategoryOption = categorySelect.options[1];
    categorySelect.value = firstRealCategoryOption.value;
    categorySelect.dispatchEvent(new Event('change'));

    const amountInput = dialog.querySelector('#tx-amount') as HTMLInputElement;
    amountInput.value = '42.50';
    amountInput.dispatchEvent(new Event('input'));

    const descriptionInput = dialog.querySelector('#tx-description') as HTMLInputElement;
    descriptionInput.value = 'Transação de teste E2E';
    descriptionInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const form = dialog.querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(dialog.open).toBe(false);
    const created = fixture.componentInstance['rows']().find(
      (row) => row.description === 'Transação de teste E2E',
    );
    expect(created?.description).toBe('Transação de teste E2E');
    expect(created?.amount).toBe('42.50');
  });

  it('toggling a sort column flips order and resets to page 1', async () => {
    const fixture = TestBed.createComponent(Transactions);
    fixture.detectChanges();
    await fixture.whenStable();
    const component = fixture.componentInstance as unknown as {
      setSort: (c: 'date' | 'description' | 'amount') => void;
      setPage: (n: number) => void;
      sort: () => string;
      order: () => string;
      page: () => number;
    };

    component.setPage(1);
    component.setSort('amount');
    expect(component.sort()).toBe('amount');
    expect(component.order()).toBe('desc');

    component.setSort('amount');
    expect(component.order()).toBe('asc');
    expect(component.page()).toBe(1);
  });

  it('select-all then bulk delete calls the repository with every visible id and clears the selection', async () => {
    const bulkDelete = vi
      .spyOn(MockTransactionRepository.prototype, 'bulkDelete')
      .mockReturnValue(of(undefined));
    vi.spyOn(ConfirmService.prototype, 'confirm').mockResolvedValue(true);

    const fixture = TestBed.createComponent(Transactions);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      toggleAll: (checked: boolean) => void;
      bulkDelete: () => Promise<void>;
      rows: () => { id: string }[];
      selectedIds: () => ReadonlySet<string>;
    };
    const expectedIds = component.rows().map((r) => r.id);
    expect(expectedIds.length).toBeGreaterThan(0);

    component.toggleAll(true);
    expect([...component.selectedIds()].sort()).toEqual([...expectedIds].sort());

    await component.bulkDelete();
    expect(bulkDelete).toHaveBeenCalledWith(expectedIds);
    expect(component.selectedIds().size).toBe(0);
  });

  it('deletes the selected installment and future installments in its series', async () => {
    const fixture = TestBed.createComponent(Transactions);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const tx = {
      ...fixture.componentInstance['rows']()[0],
      installmentGroupId: 'series-1',
      installmentNumber: 3,
      installmentCount: 10,
    };
    const list = vi
      .spyOn(MockTransactionRepository.prototype, 'list')
      .mockImplementation((filters = {}) =>
        filters.installmentGroupId === 'series-1'
          ? of([
              { ...tx, id: 'inst-2', installmentNumber: 2 },
              { ...tx, id: 'inst-3', installmentNumber: 3 },
              { ...tx, id: 'inst-4', installmentNumber: 4 },
            ])
          : of([]),
      );
    const bulkDelete = vi
      .spyOn(MockTransactionRepository.prototype, 'bulkDelete')
      .mockReturnValue(of(undefined));
    vi.spyOn(ConfirmService.prototype, 'choose').mockResolvedValue('thisAndFuture');

    await fixture.componentInstance['deleteTx'](tx);

    expect(list).toHaveBeenCalledWith({ installmentGroupId: 'series-1' });
    expect(bulkDelete).toHaveBeenCalledWith(['inst-3', 'inst-4']);
  });
});

describe('Transactions - calendar with a cross-currency month', () => {
  const today = formatIsoDate(new Date());

  // A BRL-denominated expense that posted to a USD account: its running-
  // balance delta is taken in USD (conversion.currency), so the month
  // converter must cover USD->BRL or add()/subtract() throw a currency
  // mismatch and the whole calendar fails to render.
  const crossCurrencyTx: Transaction = {
    id: 'tx-xc',
    type: 'expense',
    date: today,
    amount: '100.0000',
    currency: 'BRL',
    accountId: 'acc-1',
    categoryId: 'cat-1',
    description: 'Compra internacional',
    conversion: { amount: '19.2300', currency: 'USD', rate: '0.1923', source: 'manual' },
  };

  class StubTransactionRepository extends TransactionRepository {
    override list(): Observable<Transaction[]> {
      return of([crossCurrencyTx]);
    }
    override listPage(): Observable<Page<Transaction>> {
      return of({ items: [crossCurrencyTx], total: 1 });
    }
    override get(): Observable<Transaction | undefined> {
      return of(undefined);
    }
    override create(): Observable<Transaction> {
      return of(crossCurrencyTx);
    }
    override update(): Observable<Transaction> {
      return of(crossCurrencyTx);
    }
    override delete(): Observable<void> {
      return of(undefined);
    }
    override bulkDelete(): Observable<void> {
      return of(undefined);
    }
    override bulkCategorize(): Observable<void> {
      return of(undefined);
    }
    override importPreview(): Observable<ImportPreview> {
      return of({ headers: [], mapping: {}, rows: [] });
    }
    override importCommit(): Observable<number> {
      return of(0);
    }
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        Transactions,
        provideTestTransloco()
      ],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideTestTranslocoLocale(),
        { provide: MOCK_LATENCY_MS, useValue: 0 },
        { provide: AccountRepository, useClass: MockAccountRepository },
        { provide: TransactionRepository, useClass: StubTransactionRepository },
        { provide: CategoryRepository, useClass: MockCategoryRepository },
        { provide: CategoryGroupRepository, useClass: MockCategoryGroupRepository },
        { provide: BudgetRepository, useClass: MockBudgetRepository },
        { provide: RecurringRuleRepository, useClass: MockRecurringRuleRepository },
        { provide: InstitutionRepository, useClass: MockInstitutionRepository },
        { provide: ExchangeRateRepository, useClass: MockExchangeRateRepository }
      ]
    }).compileComponents();
  });

  it('builds the month grid without a currency mismatch', async () => {
    const fixture = TestBed.createComponent(Transactions);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance['setMode']('calendar');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const days = fixture.componentInstance['calendarDays']();
    expect(days.length).toBe(42);
    expect(days.some((d) => d.date === today && d.transactions.length === 1)).toBe(true);
  });
});

describe('Transactions - already-posted occurrences are not projected as ghosts', () => {
  const today = formatIsoDate(new Date());

  const rule: RecurringRule = {
    id: 'rule-test',
    frequency: 'weekly',
    interval: 1,
    startDate: today,
    template: {
      type: 'expense',
      amount: '50.00',
      currency: 'BRL',
      accountId: 'acc-1',
      categoryId: 'cat-1',
      description: 'Assinatura de teste'
    }
  };

  const postedTransaction: Transaction = {
    id: 'tx-posted',
    type: 'expense',
    date: today,
    amount: '50.00',
    currency: 'BRL',
    accountId: 'acc-1',
    categoryId: 'cat-1',
    description: 'Assinatura de teste',
    recurringRuleId: rule.id
  };

  class StubTransactionRepository extends TransactionRepository {
    override list(): Observable<Transaction[]> {
      return of([postedTransaction]);
    }
    override listPage(): Observable<Page<Transaction>> {
      return of({ items: [postedTransaction], total: 1 });
    }
    override get(): Observable<Transaction | undefined> {
      return of(undefined);
    }
    override create(): Observable<Transaction> {
      return of(postedTransaction);
    }
    override update(): Observable<Transaction> {
      return of(postedTransaction);
    }
    override delete(): Observable<void> {
      return of(undefined);
    }
    override bulkDelete(): Observable<void> {
      return of(undefined);
    }
    override bulkCategorize(): Observable<void> {
      return of(undefined);
    }
    override importPreview(): Observable<ImportPreview> {
      return of({ headers: [], mapping: {}, rows: [] });
    }
    override importCommit(): Observable<number> {
      return of(0);
    }
  }

  class StubRecurringRuleRepository extends RecurringRuleRepository {
    override list(): Observable<RecurringRule[]> {
      return of([rule]);
    }
    override create(): Observable<RecurringRule> {
      return of(rule);
    }
    override update(): Observable<RecurringRule> {
      return of(rule);
    }
    override delete(): Observable<void> {
      return of(undefined);
    }
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        Transactions,
        provideTestTransloco()
      ],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideTestTranslocoLocale(),
        { provide: MOCK_LATENCY_MS, useValue: 0 },
        { provide: AccountRepository, useClass: MockAccountRepository },
        { provide: TransactionRepository, useClass: StubTransactionRepository },
        { provide: CategoryRepository, useClass: MockCategoryRepository },
        { provide: CategoryGroupRepository, useClass: MockCategoryGroupRepository },
        { provide: BudgetRepository, useClass: MockBudgetRepository },
        { provide: RecurringRuleRepository, useClass: StubRecurringRuleRepository },
        { provide: InstitutionRepository, useClass: MockInstitutionRepository },
        { provide: ExchangeRateRepository, useClass: MockExchangeRateRepository }
      ]
    }).compileComponents();
  });

  it('excludes a projected occurrence whose (rule, date) already posted as a real transaction', async () => {
    const fixture = TestBed.createComponent(Transactions);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // Without the postedOccurrences guard, rule's weekly occurrence on
    // `today` would show up here too, duplicating postedTransaction.
    const projected: ProjectedTransaction[] = fixture.componentInstance['projectedRows']();
    expect(projected.some((o) => o.recurringRuleId === rule.id && o.date === today)).toBe(false);
  });
});
