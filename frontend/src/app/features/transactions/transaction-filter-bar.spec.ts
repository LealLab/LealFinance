import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { provideTranslocoLocale } from '@jsverse/transloco-locale';
import { Account } from '../../domain/models/account';
import { Category } from '../../domain/models/category';
import { CategoryGroup } from '../../domain/models/category-group';
import { Institution } from '../../domain/models/institution';
import { EMPTY_FILTERS, TransactionFilters } from './transaction-filters';
import { TransactionFilterBar } from './transaction-filter-bar';
import ptBR from '../../../../public/i18n/pt-BR.json';

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
        TranslocoTestingModule.forRoot({
          langs: { 'pt-BR': ptBR },
          translocoConfig: { availableLangs: ['pt-BR'], defaultLang: 'pt-BR' },
        }),
      ],
      providers: [
        provideTranslocoLocale({ defaultLocale: 'pt-BR', defaultCurrency: 'BRL' }),
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

  it('drills into a submenu and applies a filter', () => {
    const { fixture, el } = setup();
    (el.querySelector('[dropdownTrigger]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const accountRow = [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Conta')!;
    accountRow.click();
    fixture.detectChanges();

    const option = [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Checking')!;
    option.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.filters().accountId).toBe('acc-1');
  });

  it('renders a chip for an active filter and removes just that filter', () => {
    const { fixture, el } = setup();
    fixture.componentInstance.filters.set({ ...EMPTY_FILTERS, accountId: 'acc-1', groupId: 'g' });
    fixture.detectChanges();

    const chips = el.querySelectorAll('.rounded-full');
    expect(chips.length).toBeGreaterThanOrEqual(2);

    const removeAccount = [...el.querySelectorAll('button')].find((b) =>
      b.getAttribute('aria-label')?.includes('Conta'),
    )!;
    removeAccount.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.filters().accountId).toBe('');
    expect(fixture.componentInstance.filters().groupId).toBe('g');
  });

  it('emits clearAll from the "Clear filters" button', () => {
    const { fixture, el } = setup();
    const clear = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Limpar filtros'))!;
    clear.click();
    expect(fixture.componentInstance.cleared).toBe(true);
  });
});
