import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { provideTranslocoLocale } from '@jsverse/transloco-locale';
import { CategoryRepository } from '../../data/category.repository';
import { MockCategoryRepository } from '../../data/mock/mock-category.repository';
import { MOCK_LATENCY_MS } from '../../data/mock/mock-latency';
import { MockTransactionRepository } from '../../data/mock/mock-transaction.repository';
import { TransactionRepository } from '../../data/transaction.repository';
import { Categories } from './categories';
import ptBR from '../../../../public/i18n/pt-BR.json';

describe('Categories', () => {
  beforeEach(async () => {
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
        { provide: TransactionRepository, useClass: MockTransactionRepository }
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
});
