import { Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { ApiError } from '../../../core/api-error';
import { ConfirmService } from '../../../core/confirm.service';
import { MutationErrorService } from '../../../core/mutation-error.service';
import { AccountRepository } from '../../../data/account.repository';
import { CategoryRepository } from '../../../data/category.repository';
import { InstitutionRepository } from '../../../data/institution.repository';
import { ImportOptions, TransactionRepository } from '../../../data/transaction.repository';
import { Transaction, TransactionType } from '../../../domain/models/transaction';
import { Button } from '../../../shared/ui/button/button';
import { Card } from '../../../shared/ui/card/card';
import { Icon } from '../../../shared/ui/icon/icon';
import { PageHeader } from '../../../shared/ui/page-header/page-header';
import { groupAccountsByInstitution } from '../../accounts/institution-grouping';
import {
  compareRows,
  CsvImportRow,
  ImportSortColumn,
  isImportable,
  isReviewable,
  reviewedCount,
  toImportRows
} from './csv-import-row';

type TargetField = 'date' | 'description' | 'amount' | 'category' | 'notes';
const TARGET_FIELDS: readonly TargetField[] = ['date', 'description', 'amount', 'category', 'notes'];
const REQUIRED_FIELDS: readonly TargetField[] = ['date', 'description', 'amount'];
type RowType = 'income' | 'expense';
const ROW_TYPES: readonly RowType[] = ['expense', 'income'];

/**
 * Bank-statement CSV import: pick a file + target account, map columns
 * (server pre-guesses from headers), review/edit every parsed row in a
 * grid, then commit only the rows marked reviewed. All parsing (delimiter
 * sniffing, date/amount formats, category name matching, duplicate
 * detection) happens server-side - see backend/app/services/csv_import.py -
 * this component only holds the CSV text and the grid's edit state.
 *
 * Every mapping/option/account change re-runs the server-side preview,
 * which would silently discard in-progress review work - so any such
 * change is gated behind a confirm() once at least one row is reviewed.
 *
 * t(transactions.import.title, transactions.import.description,
 * transactions.import.remapConfirm.title, transactions.import.remapConfirm.message,
 * transactions.import.confirm.title, transactions.import.confirm.message)
 *
 * `previewErrorKey`/each row's `error` are built as `'errors.' + <backend
 * code>` (transaction-import.ts/.html), so transloco-keys-manager's static
 * extractor never sees the literal keys - same "dynamic markings" situation
 * as transaction-form-modal.ts:
 * t(errors.import.file_too_large, errors.import.no_rows, errors.import.too_many_rows,
 * errors.import.column_required, errors.import.row.invalid_date,
 * errors.import.row.invalid_amount, errors.import.row.zero_amount,
 * errors.import.row.missing_description)
 */
@Component({
  selector: 'app-transaction-import',
  imports: [TranslocoDirective, Button, Card, Icon, PageHeader],
  templateUrl: './transaction-import.html',
  styleUrl: './transaction-import.scss'
})
export class TransactionImport {
  private readonly transactionRepository = inject(TransactionRepository);
  private readonly accountRepository = inject(AccountRepository);
  private readonly categoryRepository = inject(CategoryRepository);
  private readonly institutionRepository = inject(InstitutionRepository);
  private readonly confirmService = inject(ConfirmService);
  private readonly mutationErrors = inject(MutationErrorService);
  private readonly router = inject(Router);

  protected readonly targetFields = TARGET_FIELDS;
  protected readonly rowTypes = ROW_TYPES;

  protected readonly accountsResource = rxResource({ stream: () => this.accountRepository.list() });
  protected readonly categoriesResource = rxResource({ stream: () => this.categoryRepository.list() });
  protected readonly institutionsResource = rxResource({
    stream: () => this.institutionRepository.list()
  });

  /** <optgroup>-per-institution for the account select - same helper the
   * transaction form modal uses (institution-grouping.ts). */
  protected readonly accountGroups = computed(() =>
    groupAccountsByInstitution(this.accountsResource.value() ?? [], this.institutionsResource.value() ?? [])
  );

  protected readonly fileName = signal<string | undefined>(undefined);
  private readonly csvContent = signal<string | undefined>(undefined);

  protected readonly accountId = signal('');
  protected readonly dateFormat = signal<ImportOptions['dateFormat']>('auto');
  protected readonly decimalSeparator = signal<ImportOptions['decimalSeparator']>('auto');
  protected readonly invertSign = signal(false);
  protected readonly fieldMapping = signal<Record<TargetField, string>>(this.emptyMapping());
  protected readonly headers = signal<readonly string[]>([]);

  protected readonly rows = signal<CsvImportRow[]>([]);
  protected readonly loading = signal(false);
  protected readonly previewErrorKey = signal<string | undefined>(undefined);

  protected readonly sortColumn = signal<ImportSortColumn | null>(null);
  protected readonly sortDirection = signal<'asc' | 'desc'>('asc');
  protected readonly sortedRows = computed<CsvImportRow[]>(() => {
    const column = this.sortColumn();
    if (!column) return this.rows();
    const direction = this.sortDirection() === 'asc' ? 1 : -1;
    return [...this.rows()].sort((a, b) => direction * compareRows(a, b, column));
  });

  protected readonly askBeforeImport = signal(true);
  protected readonly importing = signal(false);

  protected readonly selectedAccount = computed(() =>
    this.accountsResource.value()?.find((account) => account.id === this.accountId())
  );

  protected readonly hasFile = computed(() => this.csvContent() !== undefined);
  protected readonly reviewedRowCount = computed(() => reviewedCount(this.rows()));
  protected readonly canConfirm = computed(() => this.reviewedRowCount() > 0 && !this.importing());
  protected readonly isReviewable = isReviewable;

  private emptyMapping(): Record<TargetField, string> {
    return { date: '', description: '', amount: '', category: '', notes: '' };
  }

  protected categoriesForType(type: RowType | undefined) {
    return (this.categoriesResource.value() ?? []).filter(
      (category) => !category.archived && category.kind === type
    );
  }

  /** Income/expense tint so a row's direction reads at a glance, matching
   * the positive/negative color tokens badges already use elsewhere - a
   * stronger fill than a badge's, since a badge is a small bold pill and a
   * full-width row needs more weight to register at a glance. */
  protected rowBackgroundClass(row: CsvImportRow): string {
    if (row.type === 'income') return 'bg-positive/20';
    if (row.type === 'expense') return 'bg-negative/20';
    return '';
  }

  protected toggleSort(column: ImportSortColumn): void {
    if (this.sortColumn() === column) {
      this.sortDirection.update((direction) => (direction === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortColumn.set(column);
      this.sortDirection.set('asc');
    }
  }

  protected async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (!(await this.confirmRemapIfNeeded())) {
      input.value = '';
      return;
    }
    this.fileName.set(file.name);
    this.fieldMapping.set(this.emptyMapping());
    this.csvContent.set(await file.text());
    this.runPreview();
  }

  protected async onAccountChange(id: string): Promise<void> {
    if (!(await this.confirmRemapIfNeeded())) return;
    this.accountId.set(id);
    this.runPreview();
  }

  protected async onOptionsChanged(): Promise<void> {
    if (!(await this.confirmRemapIfNeeded())) return;
    this.runPreview();
  }

  protected async onFieldMappingChanged(field: TargetField, header: string): Promise<void> {
    if (!(await this.confirmRemapIfNeeded())) return;
    this.fieldMapping.update((current) => ({ ...current, [field]: header }));
    this.runPreview();
  }

  private async confirmRemapIfNeeded(): Promise<boolean> {
    if (!this.rows().some((row) => row.reviewed)) return true;
    return this.confirmService.confirm(
      'transactions.import.remapConfirm.title',
      'transactions.import.remapConfirm.message'
    );
  }

  private mappingPayload(): Record<string, string> {
    const mapping = this.fieldMapping();
    const payload: Record<string, string> = {};
    for (const field of TARGET_FIELDS) {
      if (mapping[field]) payload[field] = mapping[field];
    }
    return payload;
  }

  private runPreview(): void {
    const content = this.csvContent();
    const accountId = this.accountId();
    if (!content || !accountId) return;

    this.loading.set(true);
    this.previewErrorKey.set(undefined);
    this.transactionRepository
      .importPreview({
        content,
        accountId,
        mapping: this.mappingPayload(),
        options: {
          dateFormat: this.dateFormat(),
          decimalSeparator: this.decimalSeparator(),
          invertSign: this.invertSign()
        }
      })
      .subscribe({
        next: (preview) => {
          this.headers.set(preview.headers);
          const mapping = this.emptyMapping();
          for (const field of TARGET_FIELDS) mapping[field] = preview.mapping[field] ?? '';
          this.fieldMapping.set(mapping);
          this.rows.set(toImportRows(preview.rows));
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.loading.set(false);
          this.rows.set([]);
          this.previewErrorKey.set(
            error instanceof ApiError ? `errors.${error.code}` : 'errors.error.generic'
          );
        }
      });
  }

  protected missingRequiredColumn(): boolean {
    if (!this.hasFile()) return false;
    const mapping = this.fieldMapping();
    return REQUIRED_FIELDS.some((field) => !mapping[field]);
  }

  private updateRow(index: number, changes: Partial<CsvImportRow>): void {
    this.rows.update((rows) => rows.map((row) => (row.index === index ? { ...row, ...changes } : row)));
  }

  protected toggleReviewed(row: CsvImportRow): void {
    if (!row.reviewed && !isReviewable(row)) return;
    this.updateRow(row.index, { reviewed: !row.reviewed });
  }

  protected toggleAllReviewed(checked: boolean): void {
    this.rows.update((rows) =>
      rows.map((row) => (isReviewable(row) ? { ...row, reviewed: checked } : row))
    );
  }

  protected toggleExcluded(row: CsvImportRow): void {
    this.updateRow(row.index, { excluded: !row.excluded });
  }

  protected setRowDate(row: CsvImportRow, date: string): void {
    this.updateRow(row.index, { date, error: date ? undefined : row.error });
  }

  protected setRowDescription(row: CsvImportRow, description: string): void {
    this.updateRow(row.index, { description, error: description ? undefined : row.error });
  }

  protected setRowAmount(row: CsvImportRow, amount: string): void {
    this.updateRow(row.index, { amount, error: amount ? undefined : row.error });
  }

  protected setRowNotes(row: CsvImportRow, notes: string): void {
    this.updateRow(row.index, { notes: notes || undefined });
  }

  protected setRowType(row: CsvImportRow, type: RowType): void {
    const stillValid = this.categoriesForType(type).some((category) => category.id === row.categoryId);
    this.updateRow(row.index, {
      type,
      categoryId: stillValid ? row.categoryId : undefined,
      categoryName: stillValid ? row.categoryName : undefined
    });
  }

  protected setRowCategory(row: CsvImportRow, categoryId: string): void {
    const category = this.categoriesResource.value()?.find((c) => c.id === categoryId);
    this.updateRow(row.index, {
      categoryId: categoryId || undefined,
      categoryName: category?.name
    });
  }

  private toTransactionInput(row: CsvImportRow, currency: string): Omit<Transaction, 'id'> {
    return {
      type: row.type as TransactionType,
      date: row.date as string,
      amount: row.amount as string,
      currency,
      accountId: this.accountId(),
      categoryId: row.categoryId,
      description: row.description,
      notes: row.notes
    };
  }

  protected async confirmImport(): Promise<void> {
    const account = this.selectedAccount();
    if (!account) return;

    if (this.askBeforeImport()) {
      const confirmed = await this.confirmService.confirm(
        'transactions.import.confirm.title',
        'transactions.import.confirm.message',
        'default',
        { count: this.reviewedRowCount(), account: account.name }
      );
      if (!confirmed) return;
    }

    const items = this.rows()
      .filter(isImportable)
      .map((row) => this.toTransactionInput(row, account.currency));

    this.importing.set(true);
    this.transactionRepository.importCommit(items).subscribe({
      next: () => this.router.navigate(['/transactions']),
      error: () => {
        this.importing.set(false);
        this.mutationErrors.show();
      }
    });
  }
}
