import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Account } from '../../domain/models/account';
import { Category } from '../../domain/models/category';
import { CategoryGroup } from '../../domain/models/category-group';
import { Institution } from '../../domain/models/institution';
import { EMPTY_FILTERS, TransactionFilters } from './transaction-filters';
import { TransactionFilterBar } from './transaction-filter-bar';
import { provideTestTransloco, provideTestTranslocoLocale } from '../../../testing/transloco';

const accounts: Account[] = [
  { id: 'acc-1', name: 'Checking', type: 'checking', currency: 'BRL', openingBalance: '0', archived: false },
];
const groups: CategoryGroup[] = [
  { id: 'g', name: 'Essentials', kind: 'expense', color: '#000', icon: 'cart', position: 0 },
];
const categories: Category[] = [
  { id: 'c1', name: 'Groceries', kind: 'expense', groupId: 'g', color: '#000', icon: 'cart', position: 0 },
];
const institutions: Institution[] = [
  { id: 'i1', name: 'Bank', icon: 'bank', archived: false, position: 0 },
];

@Component({
  selector: 'app-filter-host',
  imports: [TransactionFilterBar],
  template: `
    <app-transaction-filter-bar
      [filters]="filters()"
      [search]="filters().search"
      [accounts]="accounts"
      [categories]="categories"
      [groups]="groups"
      [institutions]="institutions"
      (filtersChange)="filters.set($event)"
      (searchChange)="lastSearch = $event"
      (clearAll)="cleared = true"
    />
  `,
})
class FilterHost {
  readonly filters = signal<TransactionFilters>(EMPTY_FILTERS);
  readonly accounts = accounts;
  readonly categories = categories;
  readonly groups = groups;
  readonly institutions = institutions;
  lastSearch = '';
  cleared = false;
}

describe('TransactionFilterBar', () => {
  function setup() {
    TestBed.configureTestingModule({
      imports: [
        FilterHost,
        provideTestTransloco(),
      ],
      providers: [
        provideTestTranslocoLocale(),
        provideZonelessChangeDetection(),
      ],
    });
    const fixture = TestBed.createComponent(FilterHost);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('emits every keystroke on the search box', () => {
    const { fixture, el } = setup();
    const input = el.querySelector('input[type=search]') as HTMLInputElement;
    input.value = 'coffee';
    input.dispatchEvent(new Event('input'));
    expect(fixture.componentInstance.lastSearch).toBe('coffee');
  });

  it('applies a filter chosen in the filter sheet', () => {
    const { fixture, el } = setup();
    (el.querySelector('[data-action="open-filters"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('dialog')!.open).toBe(true);

    const select = el.querySelector<HTMLSelectElement>('#tx-sheet-group')!;
    select.value = 'g';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(fixture.componentInstance.filters().groupId).toBe('g');
  });

  it('applies a quick filter chosen inline', () => {
    const { fixture, el } = setup();
    const select = el.querySelector<HTMLSelectElement>('#tx-filter-account')!;
    select.value = 'acc-1';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(fixture.componentInstance.filters().accountId).toBe('acc-1');
  });

  it('shows the number of active filters on the Filters button', () => {
    const { fixture, el } = setup();
    fixture.componentInstance.filters.set({ ...EMPTY_FILTERS, accountId: 'acc-1', groupId: 'g' });
    fixture.detectChanges();

    const button = el.querySelector<HTMLButtonElement>('[data-action="open-filters"]')!;
    expect(button.textContent).toContain('2');
  });

  it('renders a chip for an active filter and removes just that filter', () => {
    const { fixture, el } = setup();
    fixture.componentInstance.filters.set({ ...EMPTY_FILTERS, accountId: 'acc-1', groupId: 'g' });
    fixture.detectChanges();

    const chips = el.querySelectorAll('.rounded-full');
    expect(chips.length).toBeGreaterThanOrEqual(2);

    const removeAccount = el.querySelector<HTMLButtonElement>('.rounded-full button')!;
    removeAccount.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.filters().accountId).toBe('');
    expect(fixture.componentInstance.filters().groupId).toBe('g');
  });

  it('hides "Clear filters" until something is active, then emits clearAll', () => {
    const { fixture, el } = setup();
    expect(el.querySelector('[data-action="clear-filters"]')).toBeNull();

    fixture.componentInstance.filters.set({ ...EMPTY_FILTERS, accountId: 'acc-1' });
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('[data-action="clear-filters"]')!.click();

    expect(fixture.componentInstance.cleared).toBe(true);
  });
});
