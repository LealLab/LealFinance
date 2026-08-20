import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { provideTranslocoLocale } from '@jsverse/transloco-locale';
import { Observable, of } from 'rxjs';
import { AccountRepository } from '../../../data/account.repository';
import { CategoryRepository } from '../../../data/category.repository';
import { MockAccountRepository } from '../../../data/mock/mock-account.repository';
import { MockCategoryRepository } from '../../../data/mock/mock-category.repository';
import { MOCK_LATENCY_MS } from '../../../data/mock/mock-latency';
import {
  ImportPreview,
  ImportPreviewRequest,
  TransactionRepository
} from '../../../data/transaction.repository';
import { Transaction } from '../../../domain/models/transaction';
import { CsvImportRow } from './csv-import-row';
import { TransactionImport } from './transaction-import';
import ptBR from '../../../../../public/i18n/pt-BR.json';

class StubTransactionRepository extends TransactionRepository {
  lastPreviewRequest?: ImportPreviewRequest;
  lastCommitItems?: readonly Omit<Transaction, 'id'>[];
  nextPreview: ImportPreview = { headers: [], mapping: {}, rows: [] };

  override list(): Observable<Transaction[]> {
    return of([]);
  }
  override get(): Observable<Transaction | undefined> {
    return of(undefined);
  }
  override create(): Observable<Transaction> {
    return of({} as Transaction);
  }
  override update(): Observable<Transaction> {
    return of({} as Transaction);
  }
  override delete(): Observable<void> {
    return of(undefined);
  }
  override importPreview(request: ImportPreviewRequest): Observable<ImportPreview> {
    this.lastPreviewRequest = request;
    return of(this.nextPreview);
  }
  override importCommit(items: readonly Omit<Transaction, 'id'>[]): Observable<number> {
    this.lastCommitItems = items;
    return of(items.length);
  }
}

/** Fakes the minimal shape transaction-import.ts reads off a file-input
 * change event - no real DOM file picker in jsdom. */
function fileSelectEvent(content: string, name = 'statement.csv'): Event {
  const file = new File([content], name, { type: 'text/csv' });
  const input = document.createElement('input');
  input.type = 'file';
  Object.defineProperty(input, 'files', { value: [file] });
  return { target: input } as unknown as Event;
}

interface TestableComponent {
  fieldMapping: () => Record<string, string>;
  rows: () => CsvImportRow[];
  canConfirm: () => boolean;
  askBeforeImport: { set(value: boolean): void };
  onFileSelected(event: Event): Promise<void>;
  onAccountChange(id: string): Promise<void>;
  toggleReviewed(row: CsvImportRow): void;
  confirmImport(): Promise<void>;
}

describe('TransactionImport', () => {
  let stubRepo: StubTransactionRepository;

  beforeEach(async () => {
    stubRepo = new StubTransactionRepository();
    await TestBed.configureTestingModule({
      imports: [
        TransactionImport,
        TranslocoTestingModule.forRoot({
          langs: { 'pt-BR': ptBR },
          translocoConfig: { availableLangs: ['pt-BR'], defaultLang: 'pt-BR' }
        })
      ],
      providers: [
        provideZonelessChangeDetection(),
        // A real route target for 'transactions' - confirmImport() navigates
        // there on success, and an unmatched route rejects the navigation.
        provideRouter([{ path: 'transactions', component: TransactionImport }]),
        provideTranslocoLocale({ defaultLocale: 'pt-BR', defaultCurrency: 'BRL' }),
        { provide: MOCK_LATENCY_MS, useValue: 0 },
        { provide: AccountRepository, useClass: MockAccountRepository },
        { provide: CategoryRepository, useClass: MockCategoryRepository },
        { provide: TransactionRepository, useValue: stubRepo }
      ]
    }).compileComponents();
  });

  it('renders the page title', async () => {
    const fixture = TestBed.createComponent(TransactionImport);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Importar');
  });

  it('does not preview until both a file and an account are chosen', async () => {
    const fixture = TestBed.createComponent(TransactionImport);
    const component = fixture.componentInstance as unknown as TestableComponent;
    fixture.detectChanges();
    await fixture.whenStable();

    await component.onFileSelected(fileSelectEvent('date,amount\n2026-01-01,-5\n'));
    expect(stubRepo.lastPreviewRequest).toBeUndefined();
  });

  it('previews once a file and account are both set, seeding the mapping from the response', async () => {
    stubRepo.nextPreview = {
      headers: ['Data', 'Valor'],
      mapping: { date: 'Data', description: null, amount: 'Valor', category: null, notes: null },
      rows: []
    };
    const fixture = TestBed.createComponent(TransactionImport);
    const component = fixture.componentInstance as unknown as TestableComponent;
    fixture.detectChanges();
    await fixture.whenStable();

    await component.onFileSelected(fileSelectEvent('Data,Valor\n2026-01-01,-5\n'));
    await component.onAccountChange('acc-checking');

    expect(stubRepo.lastPreviewRequest?.accountId).toBe('acc-checking');
    expect(component.fieldMapping()).toEqual({
      date: 'Data',
      description: '',
      amount: 'Valor',
      category: '',
      notes: ''
    });
  });

  it('keeps Confirm disabled until at least one previewed row is marked reviewed', async () => {
    stubRepo.nextPreview = {
      headers: ['date', 'amount', 'description'],
      mapping: { date: 'date', description: 'description', amount: 'amount', category: null, notes: null },
      rows: [
        {
          index: 0,
          date: '2026-01-15',
          description: 'Coffee',
          type: 'expense',
          amount: '5.00',
          categoryId: 'cat-groceries',
          categoryName: 'Groceries',
          duplicate: false
        }
      ]
    };
    const fixture = TestBed.createComponent(TransactionImport);
    const component = fixture.componentInstance as unknown as TestableComponent;
    fixture.detectChanges();
    await fixture.whenStable();

    await component.onFileSelected(fileSelectEvent('date,amount,description\n2026-01-15,-5,Coffee\n'));
    await component.onAccountChange('acc-checking');

    expect(component.canConfirm()).toBe(false);
    component.toggleReviewed(component.rows()[0]);
    expect(component.canConfirm()).toBe(true);
  });

  it('commits only the reviewed row, not an unreviewed one parsed in the same file', async () => {
    stubRepo.nextPreview = {
      headers: ['date', 'amount', 'description'],
      mapping: { date: 'date', description: 'description', amount: 'amount', category: null, notes: null },
      rows: [
        {
          index: 0,
          date: '2026-01-15',
          description: 'Coffee',
          type: 'expense',
          amount: '5.00',
          categoryId: 'cat-groceries',
          categoryName: 'Groceries',
          duplicate: false
        },
        {
          index: 1,
          date: '2026-01-16',
          description: 'Tea',
          type: 'expense',
          amount: '6.00',
          categoryId: 'cat-groceries',
          categoryName: 'Groceries',
          duplicate: false
        }
      ]
    };
    const fixture = TestBed.createComponent(TransactionImport);
    const component = fixture.componentInstance as unknown as TestableComponent;
    fixture.detectChanges();
    await fixture.whenStable();

    await component.onFileSelected(
      fileSelectEvent('date,amount,description\n2026-01-15,-5,Coffee\n2026-01-16,-6,Tea\n')
    );
    await component.onAccountChange('acc-checking');
    component.toggleReviewed(component.rows()[0]);
    component.askBeforeImport.set(false);

    await component.confirmImport();

    expect(stubRepo.lastCommitItems?.length).toBe(1);
    expect(stubRepo.lastCommitItems?.[0].description).toBe('Coffee');
  });
});
