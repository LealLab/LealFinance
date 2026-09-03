import { Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { ApiError } from '../../../core/api-error';
import { ConfirmService } from '../../../core/confirm.service';
import { MetadataService } from '../../../core/metadata.service';
import { MutationErrorService } from '../../../core/mutation-error.service';
import { SessionService } from '../../../core/session.service';
import { AccountRepository } from '../../../data/account.repository';
import { AgentChatRepository, ImportSuggestItem } from '../../../data/agent-chat.repository';
import { CategoryGroupRepository } from '../../../data/category-group.repository';
import { CategoryRepository } from '../../../data/category.repository';
import { InstitutionRepository } from '../../../data/institution.repository';
import { ImportOptions, TransactionRepository } from '../../../data/transaction.repository';
import { Category } from '../../../domain/models/category';
import { Transaction, TransactionType } from '../../../domain/models/transaction';
import { groupCategoriesByGroup } from '../category-grouping';
import { Button } from '../../../shared/ui/button/button';
import { Card } from '../../../shared/ui/card/card';
import { Icon } from '../../../shared/ui/icon/icon';
import { PageHeader } from '../../../shared/ui/page-header/page-header';
import { DEFAULT_COLOR, DEFAULT_ICON } from '../../categories/category-form-modal';
import { groupAccountsByInstitution } from '../../accounts/institution-grouping';
import {
  compareRows,
  CsvImportRow,
  ImportSortColumn,
  isImportable,
  isReviewable,
  pendingCategoryCreations,
  reviewedCount,
  toImportRows
} from './csv-import-row';

type TargetField =
  | 'date'
  | 'description'
  | 'amount'
  | 'type'
  | 'counterparty_account'
  | 'category'
  | 'notes';
const TARGET_FIELDS: readonly TargetField[] = [
  'date',
  'description',
  'amount',
  'type',
  'counterparty_account',
  'category',
  'notes'
];
const REQUIRED_FIELDS: readonly TargetField[] = ['date', 'description', 'amount'];
type RowType = 'income' | 'expense' | 'transfer';
const ROW_TYPES: readonly RowType[] = ['expense', 'income', 'transfer'];

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
 * `previewErrorKey`/`suggestErrorKey`/each row's `error` are built as
 * `'errors.' + <backend code>` (transaction-import.ts/.html), so
 * transloco-keys-manager's static extractor never sees the literal keys -
 * same "dynamic markings" situation as transaction-form-modal.ts:
 * t(errors.import.file_too_large, errors.import.no_rows, errors.import.too_many_rows,
 * errors.import.column_required, errors.import.row.invalid_date,
 * errors.import.row.invalid_amount, errors.import.row.zero_amount,
 * errors.import.row.missing_description, errors.agents.suggest_unreadable,
 * errors.agents.not_configured, errors.agents.provider_unavailable,
 * errors.error.generic, transactions.import.ai.noSuggestions)
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
  private readonly categoryGroupRepository = inject(CategoryGroupRepository);
  private readonly categoryRepository = inject(CategoryRepository);
  private readonly institutionRepository = inject(InstitutionRepository);
  private readonly agentRepository = inject(AgentChatRepository);
  private readonly metadata = inject(MetadataService);
  private readonly session = inject(SessionService);
  private readonly confirmService = inject(ConfirmService);
  private readonly mutationErrors = inject(MutationErrorService);
  private readonly router = inject(Router);

  protected readonly targetFields = TARGET_FIELDS;
  protected readonly rowTypes = ROW_TYPES;

  protected readonly accountsResource = rxResource({ stream: () => this.accountRepository.list() });
  protected readonly categoryGroupsResource = rxResource({
    stream: () => this.categoryGroupRepository.list()
  });
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
  /** Running total posted from this file so far - the page stays open after a
   * commit so the remaining rows can be imported in later batches. */
  protected readonly importedCount = signal(0);

  protected readonly suggesting = signal(false);
  protected readonly creatingCategories = signal(false);
  protected readonly suggestErrorKey = signal<string | undefined>(undefined);
  /** True once an analysis has completed for the current preview - the button
   * stays disabled afterwards. A new preview (`runPreview`) clears it. */
  protected readonly suggested = signal(false);

  /** AI Assist needs the instance flag on AND chat access for this user
   * (admins always have it) - the same rule as core/auth.guards.ts. */
  protected readonly aiAvailable = computed(() => {
    const user = this.session.user();
    return (
      !!this.metadata.settings()?.agentsEnabled &&
      (user?.role === 'admin' || !!user?.aiChatEnabled)
    );
  });

  /** New groups/categories the accepted proposals would create. */
  protected readonly pendingCreations = computed(() => pendingCategoryCreations(this.rows()));

  /** A row carries an accept-able suggestion when it points at a real
   * category and the row has none yet. */
  protected readonly acceptableSuggestionCount = computed(
    () =>
      this.rows().filter((row) => !row.categoryId && row.suggestion?.categoryId).length
  );

  protected readonly selectedAccount = computed(() =>
    this.accountsResource.value()?.find((account) => account.id === this.accountId())
  );
  protected readonly counterpartyAccounts = computed(() => {
    const selected = this.selectedAccount();
    return (this.accountsResource.value() ?? []).filter(
      (account) => account.id !== selected?.id && account.currency === selected?.currency
    );
  });

  protected readonly hasFile = computed(() => this.csvContent() !== undefined);
  protected readonly reviewedRowCount = computed(() => reviewedCount(this.rows()));
  protected readonly canConfirm = computed(() => this.reviewedRowCount() > 0 && !this.importing());
  protected readonly isReviewable = isReviewable;

  private emptyMapping(): Record<TargetField, string> {
    return {
      date: '',
      description: '',
      amount: '',
      type: '',
      counterparty_account: '',
      category: '',
      notes: ''
    };
  }

  protected mappingLabel(field: TargetField): string {
    if (field === 'type') return 'transactions.filters.type';
    if (field === 'counterparty_account') return 'transactions.form.fields.account';
    return `transactions.form.fields.${field}`;
  }

  protected categoriesForType(type: RowType | undefined) {
    return (this.categoriesResource.value() ?? []).filter(
      (category) => category.kind === type
    );
  }

  /** Human-readable name for an existing-category suggestion - the backend
   * only sends the id, so resolve it against the loaded categories the same
   * way the grid's own <select> is labelled ("Group / Category"). */
  protected suggestionCategoryLabel(row: CsvImportRow): string {
    const categoryId = row.suggestion?.categoryId;
    if (!categoryId) return '';
    const category = this.categoriesResource.value()?.find((c) => c.id === categoryId);
    if (!category) return '';
    const group = this.categoryGroupsResource.value()?.find((g) => g.id === category.groupId);
    return group ? `${group.name} / ${category.name}` : category.name;
  }

  protected categoryGroupsForType(type: RowType | undefined) {
    return groupCategoriesByGroup(
      this.categoriesForType(type),
      this.categoryGroupsResource.value() ?? []
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
          // A fresh row set is a new analysis target and a new import session.
          this.suggested.set(false);
          this.suggestErrorKey.set(undefined);
          this.importedCount.set(0);
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
    if (type === 'transfer') {
      this.updateRow(row.index, {
        type,
        categoryId: undefined,
        categoryName: undefined,
        suggestion: undefined
      });
      return;
    }
    const stillValid = this.categoriesForType(type).some((category) => category.id === row.categoryId);
    this.updateRow(row.index, {
      type,
      categoryId: stillValid ? row.categoryId : undefined,
      categoryName: stillValid ? row.categoryName : undefined,
      suggestion: stillValid ? row.suggestion : undefined
    });
  }

  protected setRowCategory(row: CsvImportRow, categoryId: string): void {
    const category = this.categoriesResource.value()?.find((c) => c.id === categoryId);
    this.updateRow(row.index, {
      categoryId: categoryId || undefined,
      categoryName: category?.name
    });
  }

  protected setRowCounterparty(row: CsvImportRow, accountId: string): void {
    const account = this.accountsResource.value()?.find((item) => item.id === accountId);
    this.updateRow(row.index, {
      counterpartyAccountId: account?.id,
      counterpartyAccountName: account?.name ?? row.counterpartyAccountName
    });
  }

  /** Key a row by its (type, cleaned description) so one AI answer covers
   * every repeat of the same merchant. */
  private suggestKey(type: RowType, description: string): string {
    return `${type} ${description.trim().toLowerCase()}`;
  }

  /** Ask the assistant to categorize every still-uncategorized, clean row.
   * De-duplicated by merchant before the call, then fanned back out. */
  protected async runSuggest(): Promise<void> {
    if (this.suggesting() || this.suggested()) return;
    const representatives = new Map<string, CsvImportRow>();
    for (const row of this.rows()) {
      if (
        row.categoryId ||
        row.error ||
        !row.description ||
        (row.type !== 'income' && row.type !== 'expense')
      )
        continue;
      const key = this.suggestKey(row.type, row.description);
      if (!representatives.has(key)) representatives.set(key, row);
    }
    if (representatives.size === 0) {
      this.suggestErrorKey.set('transactions.import.ai.noSuggestions');
      return;
    }

    const items: ImportSuggestItem[] = [...representatives.values()]
      .slice(0, 200)
      .map((row) => ({
        index: row.index,
        description: row.description,
        type: row.type as 'income' | 'expense'
      }));

    this.suggesting.set(true);
    this.suggestErrorKey.set(undefined);
    try {
      const suggestions = await firstValueFrom(this.agentRepository.suggestImportCategories(items));
      const rowByIndex = new Map(this.rows().map((row) => [row.index, row]));
      for (const suggestion of suggestions) {
        const representative = rowByIndex.get(suggestion.index);
        if (!representative || !representative.type) continue;
        const key = this.suggestKey(representative.type, representative.description);
        this.rows.update((rows) =>
          rows.map((row) =>
            !row.categoryId && row.type && this.suggestKey(row.type, row.description) === key
              ? { ...row, suggestion: { ...suggestion } }
              : row
          )
        );
      }
      if (!this.rows().some((row) => row.suggestion)) {
        this.suggestErrorKey.set('transactions.import.ai.noSuggestions');
      }
      // Analysis done for this preview - one pass only.
      this.suggested.set(true);
    } catch (error: unknown) {
      this.suggestErrorKey.set(
        error instanceof ApiError ? `errors.${error.code}` : 'errors.error.generic'
      );
    } finally {
      this.suggesting.set(false);
    }
  }

  /** Apply an existing-category suggestion to one row. */
  protected acceptSuggestion(row: CsvImportRow): void {
    const categoryId = row.suggestion?.categoryId;
    if (!categoryId) return;
    this.setRowCategory(row, categoryId);
    this.updateRow(row.index, { suggestion: undefined });
  }

  protected dismissSuggestion(row: CsvImportRow): void {
    this.updateRow(row.index, { suggestion: undefined });
  }

  /** Apply every existing-category suggestion in one go. */
  protected acceptAllSuggestions(): void {
    for (const row of this.rows()) {
      if (!row.categoryId && row.suggestion?.categoryId) this.acceptSuggestion(row);
    }
  }

  /** Create the AI-proposed groups/categories through the normal endpoints,
   * then assign the new ids to the rows that proposed them. Deliberately does
   * NOT re-run the preview - that would wipe every reviewed tick. */
  protected async createSuggestedCategories(): Promise<void> {
    const plan = this.pendingCreations();
    if (plan.length === 0 || this.creatingCategories()) return;

    this.creatingCategories.set(true);
    const createdIdByKey = new Map<string, string>();
    try {
      for (const group of plan) {
        const groupId =
          group.groupId ??
          (
            await firstValueFrom(
              this.categoryGroupRepository.create({
                name: group.groupName,
                kind: group.kind,
                color: DEFAULT_COLOR,
                icon: DEFAULT_ICON as Category['icon']
              })
            )
          ).id;
        for (const name of group.categories) {
          const category = await firstValueFrom(
            this.categoryRepository.create({
              name,
              kind: group.kind,
              groupId,
              color: DEFAULT_COLOR,
              icon: DEFAULT_ICON as Category['icon']
            })
          );
          createdIdByKey.set(this.proposalKey(group.kind, group.groupName, name), category.id);
        }
      }
    } catch {
      this.mutationErrors.show();
      this.creatingCategories.set(false);
      return;
    }

    this.categoriesResource.reload();
    this.categoryGroupsResource.reload();

    this.rows.update((rows) =>
      rows.map((row) => {
        const suggestion = row.suggestion;
        if (row.categoryId || !suggestion?.categoryName || !suggestion.groupName || !row.type) {
          return row;
        }
        const id = createdIdByKey.get(
          this.proposalKey(row.type, suggestion.groupName, suggestion.categoryName)
        );
        return id
          ? { ...row, categoryId: id, categoryName: suggestion.categoryName, suggestion: undefined }
          : row;
      })
    );
    this.creatingCategories.set(false);
  }

  private proposalKey(kind: RowType, groupName: string, categoryName: string): string {
    return `${kind}|${groupName.toLowerCase()}|${categoryName.toLowerCase()}`;
  }

  private toTransactionInput(row: CsvImportRow, currency: string): Omit<Transaction, 'id'> {
    const transfer = row.type === 'transfer';
    const incoming = row.transferDirection === 'incoming';
    return {
      type: row.type as TransactionType,
      date: row.date as string,
      amount: row.amount as string,
      currency,
      accountId: transfer && incoming ? (row.counterpartyAccountId as string) : this.accountId(),
      toAccountId: transfer
        ? incoming
          ? this.accountId()
          : row.counterpartyAccountId
        : undefined,
      categoryId: transfer ? undefined : row.categoryId,
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

    const importable = this.rows().filter(isImportable);
    const importedIndices = new Set(importable.map((row) => row.index));
    const items = importable.map((row) => this.toTransactionInput(row, account.currency));

    this.importing.set(true);
    this.transactionRepository.importCommit(items).subscribe({
      next: () => {
        this.importing.set(false);
        this.importedCount.update((total) => total + items.length);
        // Drop only the rows just posted; the rest stay for another batch.
        this.rows.update((rows) => rows.filter((row) => !importedIndices.has(row.index)));
      },
      error: () => {
        this.importing.set(false);
        this.mutationErrors.show();
      }
    });
  }

  protected goToTransactions(): void {
    this.router.navigate(['/transactions']);
  }
}
