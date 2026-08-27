import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { provideTranslocoLocale } from '@jsverse/transloco-locale';
import { Category } from '../../domain/models/category';
import { CategoryGroup } from '../../domain/models/category-group';
import { Transaction } from '../../domain/models/transaction';
import { TransactionBulkBar } from './transaction-bulk-bar';
import ptBR from '../../../../public/i18n/pt-BR.json';

function tx(over: Partial<Transaction>): Transaction {
  return {
    id: crypto.randomUUID(),
    type: 'expense',
    date: '2026-03-05',
    amount: '10.00',
    currency: 'BRL',
    accountId: 'a',
    categoryId: 'c',
    description: 'x',
    ...over,
  };
}

const groups: CategoryGroup[] = [
  { id: 'g', name: 'Essentials', kind: 'expense', color: '#000', icon: 'cart', position: 0 },
];
const categories: Category[] = [
  { id: 'c1', name: 'Groceries', kind: 'expense', groupId: 'g', color: '#000', icon: 'cart', position: 0 },
];

@Component({
  selector: 'app-bulk-host',
  imports: [TransactionBulkBar],
  template: `
    <app-transaction-bulk-bar
      [selected]="selected()"
      [categories]="categories"
      [categoryGroups]="groups"
      displayCurrency="BRL"
      [signedTotal]="signedTotal()"
      (deleteSelected)="deleted = true"
      (clear)="cleared = true"
      (assignCategory)="assigned = $event"
    />
  `,
})
class BulkHost {
  readonly selected = signal<Transaction[]>([]);
  readonly signedTotal = signal<string | null>(null);
  readonly categories = categories;
  readonly groups = groups;
  deleted = false;
  cleared = false;
  assigned?: string;
}

describe('TransactionBulkBar', () => {
  function setup() {
    TestBed.configureTestingModule({
      imports: [
        BulkHost,
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
    const fixture = TestBed.createComponent(BulkHost);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('is hidden with an empty selection', () => {
    const { el } = setup();
    expect(el.querySelector('.fixed')).toBeNull();
  });

  it('shows the count and enables the category picker for a homogeneous expense selection', () => {
    const { fixture, el } = setup();
    fixture.componentInstance.selected.set([tx({ type: 'expense' }), tx({ type: 'expense' })]);
    fixture.componentInstance.signedTotal.set('-20.00');
    fixture.detectChanges();

    expect(el.textContent).toContain('2');
    const trigger = el.querySelector('[dropdownTrigger]') as HTMLButtonElement;
    expect(trigger.disabled).toBe(false);
  });

  it('disables the category picker for a mixed-kind selection', () => {
    const { fixture, el } = setup();
    fixture.componentInstance.selected.set([tx({ type: 'income' }), tx({ type: 'expense' })]);
    fixture.detectChanges();
    const trigger = el.querySelector('[dropdownTrigger]') as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
  });

  it('emits delete and clear', () => {
    const { fixture, el } = setup();
    fixture.componentInstance.selected.set([tx({ type: 'expense' })]);
    fixture.detectChanges();
    const buttons = [...el.querySelectorAll('button')];
    buttons.find((b) => b.getAttribute('aria-label')?.includes('Excluir'))!.click();
    buttons.find((b) => b.getAttribute('aria-label')?.includes('seleç') || b.getAttribute('aria-label')?.includes('Limpar'))!.click();
    expect(fixture.componentInstance.deleted).toBe(true);
    expect(fixture.componentInstance.cleared).toBe(true);
  });
});
