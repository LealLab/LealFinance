import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { provideTranslocoLocale } from '@jsverse/transloco-locale';
import { Account } from '../../domain/models/account';
import { Category } from '../../domain/models/category';
import { Transaction } from '../../domain/models/transaction';
import { SortOrder, TransactionSort } from '../../data/transaction.repository';
import { TransactionColumn } from './transaction-columns';
import { TransactionTable } from './transaction-table';
import ptBR from '../../../../public/i18n/pt-BR.json';

function tx(id: string, over: Partial<Transaction> = {}): Transaction {
  return {
    id,
    type: 'expense',
    date: '2026-03-05',
    amount: '10.00',
    currency: 'BRL',
    accountId: 'acc-1',
    categoryId: 'cat-1',
    description: `Row ${id}`,
    ...over,
  };
}

@Component({
  selector: 'app-table-host',
  imports: [TransactionTable],
  template: `
    <app-transaction-table
      [rows]="rows()"
      [accountsById]="accountsById"
      [categoriesById]="categoriesById"
      [columns]="columns()"
      [selectedIds]="selectedIds()"
      [sort]="sort()"
      [order]="order()"
      [page]="page()"
      [pageCount]="pageCount()"
      [pageSize]="50"
      [total]="120"
      [pageSizes]="[25, 50, 100]"
      (sortChange)="lastSort = $event"
    />
  `,
})
class TableHost {
  readonly rows = signal<Transaction[]>([tx('1'), tx('2'), tx('3')]);
  readonly accountsById = new Map<string, Account>([
    ['acc-1', { id: 'acc-1', name: 'Checking', type: 'checking', currency: 'BRL', openingBalance: '0', archived: false }],
  ]);
  readonly categoriesById = new Map<string, Category>([
    ['cat-1', { id: 'cat-1', name: 'Groceries', kind: 'expense', groupId: 'g', color: '#000', icon: 'cart', position: 0 }],
  ]);
  readonly columns = signal<ReadonlySet<TransactionColumn>>(
    new Set(['date', 'description', 'category', 'account', 'amount']),
  );
  readonly selectedIds = signal<ReadonlySet<string>>(new Set());
  readonly sort = signal<TransactionSort>('date');
  readonly order = signal<SortOrder>('desc');
  readonly page = signal(5);
  readonly pageCount = signal(3);
  lastSort?: TransactionSort;
}

describe('TransactionTable', () => {
  function setup() {
    TestBed.configureTestingModule({
      imports: [
        TableHost,
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
    const fixture = TestBed.createComponent(TableHost);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('renders one row per transaction', () => {
    const { el } = setup();
    expect(el.querySelectorAll('tbody tr').length).toBe(3);
  });

  it('drives the header checkbox indeterminate on a partial selection', () => {
    const { fixture, el } = setup();
    fixture.componentInstance.selectedIds.set(new Set(['1']));
    fixture.detectChanges();
    const header = el.querySelector('thead input[type=checkbox]') as HTMLInputElement;
    expect(header.indeterminate).toBe(true);
    expect(header.checked).toBe(false);
  });

  it('emits sortChange when a sortable header is clicked', () => {
    const { fixture, el } = setup();
    const amountHeader = [...el.querySelectorAll('thead button')].find((b) =>
      b.textContent?.includes('Valor'),
    ) as HTMLButtonElement;
    amountHeader.click();
    expect(fixture.componentInstance.lastSort).toBe('amount');
  });

  it('removes one th and one td per row when a column is hidden', () => {
    const { fixture, el } = setup();
    const before = el.querySelectorAll('thead th').length;
    fixture.componentInstance.columns.set(new Set(['date', 'description', 'account', 'amount']));
    fixture.detectChanges();
    expect(el.querySelectorAll('thead th').length).toBe(before - 1);
    expect(el.querySelectorAll('tbody tr:first-child td').length).toBe(before - 1);
  });

  it('renders an elided page list for many pages', () => {
    const { fixture, el } = setup();
    fixture.componentInstance.pageCount.set(42);
    fixture.componentInstance.page.set(20);
    fixture.detectChanges();
    const nav = el.querySelector('nav')!;
    expect(nav.textContent).toContain('…');
    expect(nav.textContent).toContain('1');
    expect(nav.textContent).toContain('42');
    expect(nav.textContent).toContain('20');
  });
});
