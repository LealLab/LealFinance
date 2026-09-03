import { Injectable, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MetadataService } from '../../../core/metadata.service';
import { SessionService } from '../../../core/session.service';
import { Observable, of, throwError } from 'rxjs';
import { ApiError } from '../../../core/api-error';
import { AccountRepository } from '../../../data/account.repository';
import { CategoryGroupRepository } from '../../../data/category-group.repository';
import { CategoryRepository } from '../../../data/category.repository';
import { InstitutionRepository } from '../../../data/institution.repository';
import {
  AgentChatRepository,
  ImportSuggestion,
  ImportSuggestItem
} from '../../../data/agent-chat.repository';
import { MockAgentChatRepository } from '../../../data/mock/mock-agent-chat.repository';
import { MockAccountRepository } from '../../../data/mock/mock-account.repository';
import { MockCategoryRepository } from '../../../data/mock/mock-category.repository';
import { MockCategoryGroupRepository } from '../../../data/mock/mock-category-group.repository';
import { MockInstitutionRepository } from '../../../data/mock/mock-institution.repository';
import { MOCK_LATENCY_MS } from '../../../data/mock/mock-latency';
import { Page } from '../../../core/api-client';
import {
  ImportPreview,
  ImportPreviewRequest,
  TransactionRepository
} from '../../../data/transaction.repository';
import { Transaction } from '../../../domain/models/transaction';
import { CsvImportRow } from './csv-import-row';
import { TransactionImport } from './transaction-import';
import { provideTestTransloco, provideTestTranslocoLocale } from '../../../../testing/transloco';

class StubTransactionRepository extends TransactionRepository {
  lastPreviewRequest?: ImportPreviewRequest;
  lastCommitItems?: readonly Omit<Transaction, 'id'>[];
  nextPreview: ImportPreview = { headers: [], mapping: {}, rows: [] };

  override list(): Observable<Transaction[]> {
    return of([]);
  }
  override listPage(): Observable<Page<Transaction>> {
    return of({ items: [], total: 0 });
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
  override bulkDelete(): Observable<void> {
    return of(undefined);
  }
  override bulkCategorize(): Observable<void> {
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

@Injectable()
class StubAgentChatRepository extends MockAgentChatRepository {
  lastItems?: readonly ImportSuggestItem[];
  nextSuggestions: ImportSuggestion[] = [];
  override suggestImportCategories(
    items: readonly ImportSuggestItem[]
  ): Observable<ImportSuggestion[]> {
    this.lastItems = items;
    return of(this.nextSuggestions);
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
  sortedRows: () => CsvImportRow[];
  nonTransferRows: () => CsvImportRow[];
  transferRows: () => CsvImportRow[];
  canConfirm: () => boolean;
  askBeforeImport: { set(value: boolean): void };
  onFileSelected(event: Event): Promise<void>;
  onAccountChange(id: string): Promise<void>;
  setRowType(row: CsvImportRow, type: 'income' | 'expense' | 'transfer'): void;
  toggleAllReviewed(checked: boolean, scopedRows?: readonly CsvImportRow[]): void;
  toggleReviewed(row: CsvImportRow): void;
  toggleSort(column: 'date' | 'type' | 'amount'): void;
  confirmImport(): Promise<void>;
  importedCount: () => number;
  rowBackgroundClass(row: CsvImportRow): string;
  aiAvailable: () => boolean;
  runSuggest(): Promise<void>;
  acceptSuggestion(row: CsvImportRow): void;
  acceptAllSuggestions(): void;
  dismissSuggestion(row: CsvImportRow): void;
  createSuggestedCategories(): Promise<void>;
  suggestErrorKey: () => string | undefined;
  suggested: () => boolean;
  pendingCreations: () => { groupName: string; kind: string; categories: string[] }[];
  isReviewable: (row: CsvImportRow) => boolean;
}

const baseRow: CsvImportRow = {
  index: 0,
  description: 'Coffee',
  duplicate: false,
  reviewed: false,
  excluded: false
};

describe('TransactionImport', () => {
  let stubRepo: StubTransactionRepository;
  let agentRepo: StubAgentChatRepository;

  beforeEach(async () => {
    stubRepo = new StubTransactionRepository();
    await TestBed.configureTestingModule({
      imports: [
        TransactionImport,
        provideTestTransloco()
      ],
      providers: [
        provideZonelessChangeDetection(),
        // A real route target for 'transactions' - confirmImport() navigates
        // there on success, and an unmatched route rejects the navigation.
        provideRouter([{ path: 'transactions', component: TransactionImport }]),
        provideTestTranslocoLocale(),
        { provide: MOCK_LATENCY_MS, useValue: 0 },
        { provide: AccountRepository, useClass: MockAccountRepository },
        { provide: CategoryRepository, useClass: MockCategoryRepository },
        { provide: CategoryGroupRepository, useClass: MockCategoryGroupRepository },
        { provide: InstitutionRepository, useClass: MockInstitutionRepository },
        { provide: AgentChatRepository, useClass: StubAgentChatRepository },
        { provide: TransactionRepository, useValue: stubRepo }
      ]
    }).compileComponents();
    agentRepo = TestBed.inject(AgentChatRepository) as StubAgentChatRepository;
  });

  async function previewedRows(component: TestableComponent, rows: ImportPreview['rows']): Promise<void> {
    stubRepo.nextPreview = {
      headers: ['date', 'amount', 'description'],
      mapping: { date: 'date', description: 'description', amount: 'amount', category: null, notes: null },
      rows
    };
    await component.onFileSelected(fileSelectEvent('date,amount,description\n2026-01-15,-5,Coffee\n'));
    await component.onAccountChange('acc-checking');
  }

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
      type: '',
      counterparty_account: '',
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

    // The page stays open: the posted row is dropped, the rest remain for
    // another batch, and a running total is shown.
    expect(component.importedCount()).toBe(1);
    expect(component.rows().map((row) => row.description)).toEqual(['Tea']);

    // A second batch can be imported without re-previewing.
    component.toggleReviewed(component.rows()[0]);
    await component.confirmImport();
    expect(stubRepo.lastCommitItems?.[0].description).toBe('Tea');
    expect(component.importedCount()).toBe(2);
    expect(component.rows()).toEqual([]);
  });

  it('commits transfer rows in the direction implied by the preview', async () => {
    const fixture = TestBed.createComponent(TransactionImport);
    const component = fixture.componentInstance as unknown as TestableComponent;
    fixture.detectChanges();
    await fixture.whenStable();

    await previewedRows(component, [
      {
        ...baseRow,
        index: 0,
        date: '2026-01-15',
        type: 'transfer',
        amount: '5.00',
        counterpartyAccountId: 'acc-savings',
        counterpartyAccountName: 'PoupanÃ§a',
        transferDirection: 'outgoing'
      },
      {
        ...baseRow,
        index: 1,
        date: '2026-01-16',
        type: 'transfer',
        amount: '6.00',
        counterpartyAccountId: 'acc-savings',
        counterpartyAccountName: 'PoupanÃ§a',
        transferDirection: 'incoming'
      }
    ]);
    component.toggleReviewed(component.rows()[0]);
    component.toggleReviewed(component.rows()[1]);
    component.askBeforeImport.set(false);

    await component.confirmImport();

    expect(stubRepo.lastCommitItems).toEqual([
      expect.objectContaining({
        type: 'transfer',
        accountId: 'acc-checking',
        toAccountId: 'acc-savings',
        categoryId: undefined
      }),
      expect.objectContaining({
        type: 'transfer',
        accountId: 'acc-savings',
        toAccountId: 'acc-checking',
        categoryId: undefined
      })
    ]);
  });

  it('partitions transfer rows and moves them when their type changes', async () => {
    const fixture = TestBed.createComponent(TransactionImport);
    const component = fixture.componentInstance as unknown as TestableComponent;
    fixture.detectChanges();
    await fixture.whenStable();

    await previewedRows(component, [
      { ...baseRow, index: 0, type: 'expense', amount: '5.00', categoryId: 'cat-groceries' },
      {
        ...baseRow,
        index: 1,
        type: 'transfer',
        amount: '10.00',
        counterpartyAccountId: 'acc-savings',
        transferDirection: 'outgoing'
      },
      { ...baseRow, index: 2, type: undefined, amount: '15.00' }
    ]);

    expect(component.nonTransferRows().map((row) => row.index)).toEqual([0, 2]);
    expect(component.transferRows().map((row) => row.index)).toEqual([1]);

    component.toggleAllReviewed(true, component.nonTransferRows());
    expect(component.rows().map((row) => row.reviewed)).toEqual([true, false, false]);
    component.toggleAllReviewed(true, component.transferRows());
    expect(component.rows().map((row) => row.reviewed)).toEqual([true, true, false]);
    component.toggleAllReviewed(false, component.nonTransferRows());
    expect(component.rows().map((row) => row.reviewed)).toEqual([false, true, false]);

    component.setRowType(component.rows()[0], 'transfer');
    expect(component.nonTransferRows().map((row) => row.index)).toEqual([2]);
    expect(component.transferRows().map((row) => row.index)).toEqual([0, 1]);

    component.setRowType(component.rows()[1], 'expense');
    expect(component.nonTransferRows().map((row) => row.index)).toEqual([1, 2]);
    expect(component.transferRows().map((row) => row.index)).toEqual([0]);
  });

  it('tints a row by its income/expense direction, and leaves an undetermined row untinted', async () => {
    const fixture = TestBed.createComponent(TransactionImport);
    const component = fixture.componentInstance as unknown as TestableComponent;
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.rowBackgroundClass({ ...baseRow, type: 'income' })).toBe('bg-positive/20');
    expect(component.rowBackgroundClass({ ...baseRow, type: 'expense' })).toBe('bg-negative/20');
    expect(component.rowBackgroundClass({ ...baseRow, type: 'transfer' })).toBe('bg-accent/20');
    expect(component.rowBackgroundClass({ ...baseRow, type: undefined })).toBe('');
  });

  it('keeps the transfer type selected after a row moves to the transfer grid', async () => {
    const fixture = TestBed.createComponent(TransactionImport);
    const component = fixture.componentInstance as unknown as TestableComponent;
    fixture.detectChanges();
    await fixture.whenStable();

    await previewedRows(component, [
      { ...baseRow, type: 'expense', amount: '5.00', categoryId: 'cat-groceries' }
    ]);
    component.setRowType(component.rows()[0], 'transfer');
    fixture.detectChanges();

    const typeSelect = fixture.nativeElement.querySelector('table select') as HTMLSelectElement;
    expect(typeSelect.value).toBe('transfer');
  });

  it('hides AI Assist when the AI feature is not available to the user', async () => {
    const fixture = TestBed.createComponent(TransactionImport);
    const component = fixture.componentInstance as unknown as TestableComponent;
    fixture.detectChanges();
    await fixture.whenStable();

    // No public settings and no signed-in user in this harness.
    expect(component.aiAvailable()).toBe(false);
  });

  it('fans one merchant suggestion out to every row with that description', async () => {
    const fixture = TestBed.createComponent(TransactionImport);
    const component = fixture.componentInstance as unknown as TestableComponent;
    fixture.detectChanges();
    await fixture.whenStable();

    await previewedRows(component, [
      { ...baseRow, index: 0, description: 'UBER TRIP', type: 'expense', amount: '12.00' },
      { ...baseRow, index: 1, description: 'UBER TRIP', type: 'expense', amount: '8.00' },
      { ...baseRow, index: 2, description: 'GROCER', type: 'expense', amount: '30.00' }
    ]);
    agentRepo.nextSuggestions = [{ index: 0, categoryId: 'cat-transport' }];

    await component.runSuggest();

    // De-duplicated before the call: UBER once, GROCER once.
    expect(agentRepo.lastItems?.length).toBe(2);
    const rows = component.rows();
    expect(rows[0].suggestion?.categoryId).toBe('cat-transport');
    expect(rows[1].suggestion?.categoryId).toBe('cat-transport');
    expect(rows[2].suggestion).toBeUndefined();

    // Analysis is one-shot: a second run is a no-op.
    expect(component.suggested()).toBe(true);
    agentRepo.lastItems = undefined;
    await component.runSuggest();
    expect(agentRepo.lastItems).toBeUndefined();
  });

  it('accepting a suggestion assigns the category and makes the row reviewable', async () => {
    const fixture = TestBed.createComponent(TransactionImport);
    const component = fixture.componentInstance as unknown as TestableComponent;
    fixture.detectChanges();
    await fixture.whenStable();

    await previewedRows(component, [
      { ...baseRow, index: 0, description: 'UBER TRIP', type: 'expense', amount: '12.00' }
    ]);
    agentRepo.nextSuggestions = [{ index: 0, categoryId: 'cat-groceries' }];
    await component.runSuggest();

    expect(component.isReviewable(component.rows()[0])).toBe(false);
    component.acceptSuggestion(component.rows()[0]);

    const row = component.rows()[0];
    expect(row.categoryId).toBe('cat-groceries');
    expect(row.suggestion).toBeUndefined();
    expect(component.isReviewable(row)).toBe(true);
  });

  it('surfaces a translated key when the AI call fails, and reports when nothing came back', async () => {
    const fixture = TestBed.createComponent(TransactionImport);
    const component = fixture.componentInstance as unknown as TestableComponent;
    fixture.detectChanges();
    await fixture.whenStable();

    // Nothing to categorize -> a "no suggestions" notice, no call made.
    await component.runSuggest();
    expect(component.suggestErrorKey()).toBe('transactions.import.ai.noSuggestions');

    await previewedRows(component, [
      { ...baseRow, index: 0, description: 'UBER', type: 'expense', amount: '9.00' }
    ]);
    agentRepo.suggestImportCategories = () =>
      throwError(() => new ApiError(502, 'agents.suggest_unreadable', {}));
    await component.runSuggest();
    expect(component.suggestErrorKey()).toBe('errors.agents.suggest_unreadable');
  });

  it('accept-all applies every existing-category suggestion; dismiss clears one', async () => {
    const fixture = TestBed.createComponent(TransactionImport);
    const component = fixture.componentInstance as unknown as TestableComponent;
    fixture.detectChanges();
    await fixture.whenStable();

    await previewedRows(component, [
      { ...baseRow, index: 0, description: 'A', type: 'expense', amount: '1.00' },
      { ...baseRow, index: 1, description: 'B', type: 'expense', amount: '2.00' }
    ]);
    agentRepo.nextSuggestions = [
      { index: 0, categoryId: 'cat-a' },
      { index: 1, categoryId: 'cat-b' }
    ];
    await component.runSuggest();

    component.dismissSuggestion(component.rows()[1]);
    expect(component.rows()[1].suggestion).toBeUndefined();

    component.acceptAllSuggestions();
    expect(component.rows()[0].categoryId).toBe('cat-a');
    expect(component.rows()[1].categoryId).toBeUndefined();
  });

  it('creates the AI-proposed group and categories, then assigns the new ids to their rows without re-previewing', async () => {
    const fixture = TestBed.createComponent(TransactionImport);
    const component = fixture.componentInstance as unknown as TestableComponent;
    fixture.detectChanges();
    await fixture.whenStable();

    await previewedRows(component, [
      { ...baseRow, index: 0, description: 'VET CLINIC', type: 'expense', amount: '80.00' },
      { ...baseRow, index: 1, description: 'VET CLINIC', type: 'expense', amount: '20.00' }
    ]);
    agentRepo.nextSuggestions = [{ index: 0, groupName: 'Pets', categoryName: 'Veterinary' }];
    await component.runSuggest();

    expect(component.pendingCreations()).toEqual([
      { groupName: 'Pets', kind: 'expense', categories: ['Veterinary'] }
    ]);
    component.toggleReviewed(component.rows()[0]);
    stubRepo.lastPreviewRequest = undefined;

    await component.createSuggestedCategories();

    const rows = component.rows();
    expect(rows[0].categoryId).toBeTruthy();
    expect(rows[0].categoryName).toBe('Veterinary');
    expect(rows[1].categoryId).toBe(rows[0].categoryId);
    expect(rows[0].suggestion).toBeUndefined();
    // The reviewed tick and preview state are untouched - no re-parse.
    expect(stubRepo.lastPreviewRequest).toBeUndefined();
    expect(component.pendingCreations()).toEqual([]);
  });

  it('sorts the grid by amount ascending, then descending, without reordering the underlying rows', async () => {
    stubRepo.nextPreview = {
      headers: ['date', 'amount', 'description'],
      mapping: { date: 'date', description: 'description', amount: 'amount', category: null, notes: null },
      rows: [
        { ...baseRow, index: 0, date: '2026-01-15', amount: '50.00', type: 'expense' },
        { ...baseRow, index: 1, date: '2026-01-16', amount: '5.00', type: 'expense' }
      ]
    };
    const fixture = TestBed.createComponent(TransactionImport);
    const component = fixture.componentInstance as unknown as TestableComponent;
    fixture.detectChanges();
    await fixture.whenStable();

    await component.onFileSelected(
      fileSelectEvent('date,amount,description\n2026-01-15,-50,Coffee\n2026-01-16,-5,Tea\n')
    );
    await component.onAccountChange('acc-checking');

    component.toggleSort('amount');
    expect(component.sortedRows().map((row) => row.amount)).toEqual(['5.00', '50.00']);
    expect(component.rows().map((row) => row.amount)).toEqual(['50.00', '5.00']);

    component.toggleSort('amount');
    expect(component.sortedRows().map((row) => row.amount)).toEqual(['50.00', '5.00']);
  });
});

describe('TransactionImport with AI available', () => {
  let stubRepo: StubTransactionRepository;
  let agentRepo: StubAgentChatRepository;

  beforeEach(async () => {
    stubRepo = new StubTransactionRepository();
    await TestBed.configureTestingModule({
      imports: [TransactionImport, provideTestTransloco()],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([{ path: 'transactions', component: TransactionImport }]),
        provideTestTranslocoLocale(),
        { provide: MOCK_LATENCY_MS, useValue: 0 },
        { provide: AccountRepository, useClass: MockAccountRepository },
        { provide: CategoryRepository, useClass: MockCategoryRepository },
        { provide: CategoryGroupRepository, useClass: MockCategoryGroupRepository },
        { provide: InstitutionRepository, useClass: MockInstitutionRepository },
        { provide: AgentChatRepository, useClass: StubAgentChatRepository },
        { provide: TransactionRepository, useValue: stubRepo },
        { provide: MetadataService, useValue: { settings: () => ({ agentsEnabled: true }) } },
        {
          provide: SessionService,
          useValue: { user: () => ({ role: 'admin', aiChatEnabled: true }) }
        }
      ]
    }).compileComponents();
    agentRepo = TestBed.inject(AgentChatRepository) as StubAgentChatRepository;
  });

  it('renders the AI toolbar, the proposals card, and the accept-all control', async () => {
    const fixture = TestBed.createComponent(TransactionImport);
    const component = fixture.componentInstance as unknown as {
      aiAvailable: () => boolean;
      runSuggest(): Promise<void>;
      onFileSelected(e: Event): Promise<void>;
      onAccountChange(id: string): Promise<void>;
    };
    fixture.detectChanges();
    await fixture.whenStable();

    stubRepo.nextPreview = {
      headers: ['date', 'amount', 'description'],
      mapping: { date: 'date', description: 'description', amount: 'amount', category: null, notes: null },
      rows: [
        { ...baseRow, index: 0, description: 'UBER', type: 'expense', amount: '9.00' },
        { ...baseRow, index: 1, description: 'VET', type: 'expense', amount: '40.00' }
      ]
    };
    await component.onFileSelected(fileSelectEvent('date,amount,description\n2026-01-15,-9,UBER\n'));
    await component.onAccountChange('acc-checking');
    agentRepo.nextSuggestions = [
      { index: 0, categoryId: 'cat-groceries' },
      { index: 1, groupName: 'Pets', categoryName: 'Vet' }
    ];
    await component.runSuggest();
    fixture.detectChanges();
    await fixture.whenStable();

    // provideTestTranslocoLocale() resolves pt-BR catalog values.
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(component.aiAvailable()).toBe(true);
    expect(text).toContain('Assistente de IA');
    // The accept-all card, with its heading and count.
    expect(text).toContain('Sugestões de categoria');
    expect(text).toContain('Aceitar todas (1)');
    // The proposals card.
    expect(text).toContain('Novas categorias a criar');
    // Existing-category pick shows the resolved "Group / Category" name...
    expect(text).toContain('Alimentação / Supermercado');
    // ...and a proposal shows the "(new)" badge.
    expect(text).toContain('Pets / Vet (nova)');
  });
});
