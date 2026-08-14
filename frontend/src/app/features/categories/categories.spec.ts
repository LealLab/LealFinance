import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { provideTranslocoLocale } from '@jsverse/transloco-locale';
import { BudgetRepository } from '../../data/budget.repository';
import { CategoryRepository } from '../../data/category.repository';
import { MockBudgetRepository } from '../../data/mock/mock-budget.repository';
import { MockCategoryRepository } from '../../data/mock/mock-category.repository';
import { MOCK_LATENCY_MS } from '../../data/mock/mock-latency';
import { MockTransactionRepository } from '../../data/mock/mock-transaction.repository';
import { TransactionRepository } from '../../data/transaction.repository';
import { ConfirmService } from '../../core/confirm.service';
import { Categories } from './categories';
import ptBR from '../../../../public/i18n/pt-BR.json';

function findRowDeleteButton(el: HTMLElement, name: string): HTMLButtonElement {
  const nameSpan = Array.from(el.querySelectorAll('span')).find((s) => s.textContent?.trim() === name);
  const row = nameSpan!.closest('li') as HTMLLIElement;
  const ownRow = row.querySelector(':scope > div') as HTMLElement;
  return ownRow.querySelector('button[aria-label="Excluir"]') as HTMLButtonElement;
}

describe('Categories', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [
        Categories,
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
        { provide: CategoryRepository, useClass: MockCategoryRepository },
        { provide: TransactionRepository, useClass: MockTransactionRepository },
        { provide: BudgetRepository, useClass: MockBudgetRepository }
      ]
    }).compileComponents();
  });

  it('renders the seeded categories, grouped by income/expense, without error', async () => {
    const fixture = TestBed.createComponent(Categories);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Categorias de despesa');
    expect(fixture.nativeElement.textContent).toContain('Moradia');
  });

  it('creates a new category end-to-end through the modal', async () => {
    const fixture = TestBed.createComponent(Categories);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const newButton = Array.from(el.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Nova categoria')
    );
    newButton!.click();
    fixture.detectChanges();

    const dialog = el.querySelector('dialog') as HTMLDialogElement;
    expect(dialog.open).toBe(true);

    const nameInput = dialog.querySelector('#category-name') as HTMLInputElement;
    nameInput.value = 'Categoria de Teste E2E';
    nameInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const form = dialog.querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(dialog.open).toBe(false);
    expect(el.textContent).toContain('Categoria de Teste E2E');
  });

  it('blocks deleting a category that still has child categories, and does not delete it', async () => {
    const fixture = TestBed.createComponent(Categories);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const confirmService = TestBed.inject(ConfirmService);

    // "Moradia" (housing) has three child categories in the fixtures
    // (Aluguel/Condomínio/Energia) - deleting it must be blocked.
    findRowDeleteButton(el, 'Moradia').click();
    fixture.detectChanges();
    await fixture.whenStable();

    // The confirm dialog itself is mounted once in the app shell (not
    // inside Categories), so assert against the pending ConfirmService
    // request rather than rendered dialog text.
    const request = confirmService.request();
    expect(request?.titleKey).toBe('categories.delete.blockedTitle');
    expect(request?.messageKey).toBe('categories.delete.blockedMessage');
    expect(request?.params).toEqual(expect.objectContaining({ children: 3 }));

    confirmService.respond(true);
    await fixture.whenStable();
    fixture.detectChanges();

    // Still there - the blocked path must never call delete().
    expect(el.textContent).toContain('Moradia');
  });

  it('deletes a category with no references after the user confirms', async () => {
    const fixture = TestBed.createComponent(Categories);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const confirmService = TestBed.inject(ConfirmService);

    // "Outras Despesas" has no transactions, budgets, or children in the fixtures.
    findRowDeleteButton(el, 'Outras Despesas').click();
    fixture.detectChanges();
    await fixture.whenStable();

    const request = confirmService.request();
    expect(request?.titleKey).toBe('categories.delete.title');

    confirmService.respond(true);
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.textContent).not.toContain('Outras Despesas');
  });

  it('collapsing a parent hides its children and persists the choice to localStorage', async () => {
    const fixture = TestBed.createComponent(Categories);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Aluguel');

    const nameSpan = Array.from(el.querySelectorAll('span')).find((s) => s.textContent?.trim() === 'Moradia');
    const row = nameSpan!.closest('li') as HTMLLIElement;
    const collapseButton = row.querySelector('button[aria-expanded]') as HTMLButtonElement;
    collapseButton.click();
    fixture.detectChanges();

    expect(el.textContent).not.toContain('Aluguel');

    const stored = JSON.parse(localStorage.getItem('lealfinance.categories.collapsed') ?? '[]');
    expect(stored).toHaveLength(1);

    // Toggling again restores the children and clears the persisted id.
    collapseButton.click();
    fixture.detectChanges();
    expect(el.textContent).toContain('Aluguel');
    expect(JSON.parse(localStorage.getItem('lealfinance.categories.collapsed') ?? '[]')).toHaveLength(0);
  });

  it('reorders top-level categories and reflects the new order after reload', async () => {
    const fixture = TestBed.createComponent(Categories);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const namesBefore = Array.from(el.querySelectorAll('#categories-parents-expense > li')).map(
      (li) => li.querySelector('span.font-medium')?.textContent?.trim()
    );
    expect(namesBefore[0]).toBe('Moradia');
    expect(namesBefore[1]).toBe('Alimentação');

    // Drive the reorder the same way the spec recommends for CDK drops in
    // jsdom: call the drop handler directly with a minimal event shape
    // rather than simulating a real pointer drag.
    (fixture.componentInstance as unknown as { onParentDrop: (kind: 'expense', event: unknown) => void }).onParentDrop(
      'expense',
      { previousIndex: 0, currentIndex: 1 }
    );
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const namesAfter = Array.from(el.querySelectorAll('#categories-parents-expense > li')).map(
      (li) => li.querySelector('span.font-medium')?.textContent?.trim()
    );
    expect(namesAfter[0]).toBe('Alimentação');
    expect(namesAfter[1]).toBe('Moradia');
  });
});
