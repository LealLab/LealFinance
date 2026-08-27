import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { provideTranslocoLocale } from '@jsverse/transloco-locale';
import { ConfirmService } from '../../core/confirm.service';
import { DisplayCurrencyService } from '../../core/display-currency.service';
import { CategoryGroupRepository } from '../../data/category-group.repository';
import { CategoryRepository } from '../../data/category.repository';
import { ExchangeRateRepository } from '../../data/exchange-rate.repository';
import { MockCategoryGroupRepository } from '../../data/mock/mock-category-group.repository';
import { MockCategoryRepository } from '../../data/mock/mock-category.repository';
import { MockExchangeRateRepository } from '../../data/mock/mock-exchange-rate.repository';
import { MOCK_LATENCY_MS } from '../../data/mock/mock-latency';
import { MockTransactionRepository } from '../../data/mock/mock-transaction.repository';
import { TransactionRepository } from '../../data/transaction.repository';
import { Categories } from './categories';
import enUS from '../../../../public/i18n/en-US.json';

function findGroupRow(el: HTMLElement, name: string): HTMLLIElement | null {
  const span = Array.from(el.querySelectorAll('#category-groups-expense > li span, #category-groups-income > li span')).find(
    (item) => item.textContent?.trim() === name
  );
  return (span?.closest('li') as HTMLLIElement | null) ?? null;
}

function findCategoryRow(el: HTMLElement, name: string): HTMLLIElement | null {
  const span = Array.from(el.querySelectorAll('ul[id^="category-list-"] li span')).find(
    (item) => item.textContent?.trim() === name
  );
  return (span?.closest('li') as HTMLLIElement | null) ?? null;
}

function findDeleteButton(row: HTMLLIElement): HTMLButtonElement | null {
  return row.querySelector(':scope > div button[aria-label="Delete"]');
}

describe('Categories', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [
        Categories,
        TranslocoTestingModule.forRoot({
          langs: { 'en-US': enUS },
          translocoConfig: { availableLangs: ['en-US'], defaultLang: 'en-US' }
        })
      ],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideTranslocoLocale({ defaultLocale: 'en-US', defaultCurrency: 'USD' }),
        { provide: MOCK_LATENCY_MS, useValue: 0 },
        { provide: CategoryGroupRepository, useClass: MockCategoryGroupRepository },
        { provide: CategoryRepository, useClass: MockCategoryRepository },
        { provide: TransactionRepository, useClass: MockTransactionRepository },
        { provide: ExchangeRateRepository, useClass: MockExchangeRateRepository }
      ]
    }).compileComponents();
  });

  it('renders groups and categories by income/expense, without error', async () => {
    const fixture = TestBed.createComponent(Categories);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Expense categories');
    expect(fixture.nativeElement.textContent).toContain('Moradia');
    expect(fixture.componentInstance['expenseRows']().find((row) => row.group.name === 'Moradia')).toEqual(
      expect.objectContaining({ categoryCount: 3 })
    );
  });

  it('creates a new category end-to-end through the modal', async () => {
    const fixture = TestBed.createComponent(Categories);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const newButton = Array.from(el.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Add category')
    );
    newButton!.click();
    fixture.detectChanges();

    const dialog = el.querySelector('dialog') as HTMLDialogElement;
    expect(dialog.open).toBe(true);

    const nameInput = dialog.querySelector('#category-name') as HTMLInputElement;
    nameInput.value = 'Test category';
    nameInput.dispatchEvent(new Event('input'));
    const groupSelect = dialog.querySelector('#category-group') as HTMLSelectElement;
    groupSelect.value = groupSelect.options[1].value;
    groupSelect.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const form = dialog.querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(dialog.open).toBe(false);
    expect(el.textContent).toContain('Test category');
  });

  it('creates and deletes an empty group, while hiding delete for groups with categories', async () => {
    const fixture = TestBed.createComponent(Categories);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(findDeleteButton(findGroupRow(el, 'Moradia')!)).toBeNull();

    const addGroupButton = Array.from(el.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Add group')
    )!;
    addGroupButton.click();
    fixture.detectChanges();
    const dialog = el.querySelector('dialog') as HTMLDialogElement;
    expect(dialog.querySelector('#category-group')).toBeNull();
    const nameInput = dialog.querySelector('#category-name') as HTMLInputElement;
    nameInput.value = 'Empty group';
    nameInput.dispatchEvent(new Event('input'));
    const form = dialog.querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const row = findGroupRow(el, 'Empty group')!;
    const deleteButton = findDeleteButton(row);
    expect(deleteButton).toBeTruthy();
    deleteButton!.click();
    fixture.detectChanges();

    const confirmService = TestBed.inject(ConfirmService);
    expect(confirmService.request()?.titleKey).toBe('categories.deleteGroup.title');
    expect(confirmService.request()?.messageKey).toBe('categories.deleteGroup.message');
    confirmService.respond(true);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(findGroupRow(el, 'Empty group')).toBeNull();
  });

  it('blocks deleting a category that still has transactions, and does not delete it', async () => {
    const fixture = TestBed.createComponent(Categories);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const confirmService = TestBed.inject(ConfirmService);
    findDeleteButton(findCategoryRow(el, 'Aluguel')!)!.click();
    fixture.detectChanges();
    await fixture.whenStable();

    const request = confirmService.request();
    expect(request?.titleKey).toBe('categories.delete.blockedTitle');
    expect(request?.messageKey).toBe('categories.delete.blockedMessage');
    expect(request?.params).toEqual(expect.objectContaining({ transactions: expect.any(Number) }));

    confirmService.respond(true);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(findCategoryRow(el, 'Aluguel')).toBeTruthy();
  });

  it('deletes a category with no transaction references after the user confirms', async () => {
    const fixture = TestBed.createComponent(Categories);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const confirmService = TestBed.inject(ConfirmService);
    findDeleteButton(findCategoryRow(el, 'Outras Despesas')!)!.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(confirmService.request()?.titleKey).toBe('categories.delete.title');
    confirmService.respond(true);
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(findCategoryRow(el, 'Outras Despesas')).toBeNull();
  });

  it('collapsing a group hides its categories and persists the choice to localStorage', async () => {
    const fixture = TestBed.createComponent(Categories);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Aluguel');

    const row = findGroupRow(el, 'Moradia')!;
    const collapseButton = row.querySelector('button[aria-expanded]') as HTMLButtonElement;
    collapseButton.click();
    fixture.detectChanges();

    expect(el.textContent).not.toContain('Aluguel');
    expect(JSON.parse(localStorage.getItem('lealfinance.categories.collapsed') ?? '[]')).toHaveLength(1);

    collapseButton.click();
    fixture.detectChanges();
    expect(el.textContent).toContain('Aluguel');
    expect(JSON.parse(localStorage.getItem('lealfinance.categories.collapsed') ?? '[]')).toHaveLength(0);
  });

  it('reorders groups and reflects the new order after reload', async () => {
    const fixture = TestBed.createComponent(Categories);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const namesBefore = Array.from(el.querySelectorAll('#category-groups-expense > li span.text-sm.font-medium')).map(
      (span) => span.textContent?.trim()
    );
    expect(namesBefore[0]).toBe('Moradia');
    expect(namesBefore[1]).toContain('Alimenta');

    (fixture.componentInstance as unknown as { onGroupDrop: (kind: 'expense', event: unknown) => void }).onGroupDrop(
      'expense',
      { previousIndex: 0, currentIndex: 1 }
    );
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const namesAfter = Array.from(el.querySelectorAll('#category-groups-expense > li span.text-sm.font-medium')).map(
      (span) => span.textContent?.trim()
    );
    expect(namesAfter[0]).toContain('Alimenta');
    expect(namesAfter[1]).toBe('Moradia');
  });

  it('reveals row actions on hover/focus and keeps them in the DOM', async () => {
    const fixture = TestBed.createComponent(Categories);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const row = findGroupRow(fixture.nativeElement as HTMLElement, 'Moradia')!;
    const editButton = row.querySelector('button[aria-label="Edit"]') as HTMLButtonElement;
    expect(editButton.classList).toContain('opacity-0');
    expect(editButton.classList).toContain('group-hover/row:opacity-100');
    expect(editButton.classList).toContain('group-focus-within/row:opacity-100');
    expect(editButton.classList).toContain('focus-visible:opacity-100');
  });

  it('converts category spend when the display currency changes', async () => {
    const displayCurrency = TestBed.inject(DisplayCurrencyService);
    displayCurrency.setCurrency('BRL');
    const fixture = TestBed.createComponent(Categories);
    fixture.detectChanges();
    await fixture.whenStable();

    displayCurrency.setCurrency('USD');
    fixture.detectChanges();
    await fixture.whenStable();

    const rows = [...fixture.componentInstance['expenseRows'](), ...fixture.componentInstance['incomeRows']()];
    expect(rows.some((row) => row.spend.amount !== '0.0000')).toBe(true);
    expect(rows.every((row) => row.spend.currency === 'USD')).toBe(true);
  });
});
