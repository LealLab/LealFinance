import { Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { TranslocoDirective } from '@jsverse/transloco';
import { ConfirmService } from '../../core/confirm.service';
import { DisplayCurrencyService } from '../../core/display-currency.service';
import { MutationErrorService } from '../../core/mutation-error.service';
import { openOnNewParam } from '../../core/open-on-new-param';
import { CategoryGroupRepository } from '../../data/category-group.repository';
import { CategoryRepository } from '../../data/category.repository';
import { TransactionRepository } from '../../data/transaction.repository';
import {
  categoryGroupUsage,
  categoryUsage,
  isCategoryDeletable,
  isCategoryGroupDeletable
} from '../../domain/calc/category-usage';
import { effectiveAmount } from '../../domain/calc/conversion';
import { monthKey, todayIso } from '../../domain/calc/dates';
import { Category, CategoryKind } from '../../domain/models/category';
import { CategoryGroup } from '../../domain/models/category-group';
import { add, Money, zero } from '../../shared/money/money';
import { displayConverter } from '../../shared/money/display-converter';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { Button } from '../../shared/ui/button/button';
import { Card } from '../../shared/ui/card/card';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { Icon } from '../../shared/ui/icon/icon';
import { ExchangeRateWarning } from '../../shared/exchange-rate-warning/exchange-rate-warning';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { CategoryCollapseService } from './category-collapse.service';
import { CategoryFormModal } from './category-form-modal';

interface CategoryRow {
  category: Category;
  spend: Money;
}

interface GroupRow {
  group: CategoryGroup;
  spend: Money;
  categoryCount: number;
  categories: CategoryRow[];
}

/**
 * The literal keys passed to `confirmService.confirm(...)` below are real
 * string literals, but the call itself isn't to the `t` marker function,
 * so transloco-keys-manager's extractor never sees them - same "dynamic
 * markings" situation as transactions.ts / budgets.ts:
 * t(categories.delete.title, categories.delete.message, categories.delete.blockedTitle, categories.delete.blockedMessage, categories.deleteGroup.title, categories.deleteGroup.message)
 */
@Component({
  selector: 'app-categories',
  imports: [
    TranslocoDirective,
    MoneyPipe,
    Button,
    Card,
    EmptyState,
    Icon,
    PageHeader,
    ExchangeRateWarning,
    CategoryFormModal,
    CdkDropList,
    CdkDrag,
    CdkDragHandle,
    Skeleton
  ],
  templateUrl: './categories.html',
  styleUrl: './categories.scss'
})
export class Categories {
  private readonly mutationErrors = inject(MutationErrorService);
  private readonly categoryGroupRepository = inject(CategoryGroupRepository);
  private readonly categoryRepository = inject(CategoryRepository);
  private readonly transactionRepository = inject(TransactionRepository);
  private readonly confirmService = inject(ConfirmService);
  protected readonly displayCurrencyService = inject(DisplayCurrencyService);
  protected readonly collapseService = inject(CategoryCollapseService);

  protected readonly categoryGroupsResource = rxResource({
    stream: () => this.categoryGroupRepository.list()
  });
  protected readonly categoriesResource = rxResource({ stream: () => this.categoryRepository.list() });
  protected readonly transactionsResource = rxResource({
    stream: () => this.transactionRepository.list()
  });
  protected readonly displayCurrency = this.displayCurrencyService.currency;

  private readonly foreignCurrencies = computed(() => {
    const display = this.displayCurrency();
    return Array.from(
      new Set(
        (this.transactionsResource.value() ?? []).map(
          (transaction) => effectiveAmount(transaction).currency
        )
      )
    ).filter((currency) => currency !== display);
  });

  private readonly rates = displayConverter(() => this.foreignCurrencies());
  private readonly converter = this.rates.converter;
  protected readonly hasFallbackRate = this.rates.hasFallbackRate;
  protected readonly ratesReady = computed(() => this.converter() !== null);

  protected readonly formOpen = signal(false);
  protected readonly formMode = signal<'category' | 'group'>('category');
  protected readonly editingCategory = signal<Category | undefined>(undefined);
  protected readonly editingGroup = signal<CategoryGroup | undefined>(undefined);
  protected readonly presetGroup = signal<CategoryGroup | undefined>(undefined);

  constructor() {
    openOnNewParam(() => this.openCreateCategory());
  }

  private readonly spendByCategory = computed<Map<string, Money>>(() => {
    const convert = this.converter();
    if (!convert) return new Map();
    const currentMonth = monthKey(todayIso());
    const transactions = this.transactionsResource.value() ?? [];
    const categories = this.categoriesResource.value() ?? [];
    const kindById = new Map(categories.map((c) => [c.id, c.kind]));

    const totals = new Map<string, Money>();
    for (const tx of transactions) {
      if (!tx.categoryId || monthKey(tx.date) !== currentMonth) continue;
      const kind = kindById.get(tx.categoryId);
      if (!kind || tx.type !== kind) continue;
      const current = totals.get(tx.categoryId) ?? zero(this.displayCurrency());
      totals.set(tx.categoryId, add(current, convert(effectiveAmount(tx), this.displayCurrency())));
    }
    return totals;
  });

  private buildRows(kind: CategoryKind): GroupRow[] {
    const groups = (this.categoryGroupsResource.value() ?? [])
      .filter((group) => group.kind === kind)
      .sort((a, b) => a.position - b.position);
    const categories = this.categoriesResource.value() ?? [];
    const spend = this.spendByCategory();

    return groups.map((group) => {
      const categoryRows = categories
        .filter((category) => category.groupId === group.id)
        .sort((a, b) => a.position - b.position)
        .map((category) => ({
          category,
          spend: spend.get(category.id) ?? zero(this.displayCurrency())
        }));
      const groupSpend = categoryRows.reduce(
        (total, row) => add(total, row.spend),
        zero(this.displayCurrency())
      );

      return {
        group,
        spend: groupSpend,
        categoryCount: categoryRows.length,
        categories: categoryRows
      };
    });
  }

  protected readonly incomeRows = computed(() => this.buildRows('income'));
  protected readonly expenseRows = computed(() => this.buildRows('expense'));

  /**
   * A plain array (not built inline in the template) so each section's
   * translation key is a property path the extractor can follow - see
   * layout/sidebar.ts's NAV_ITEMS for the same reasoning.
   *
   * t(categories.sections.expense, categories.sections.income)
   */
  protected readonly sections = computed(() => [
    { kind: 'expense' as const, rows: this.expenseRows(), titleKey: 'categories.sections.expense' },
    { kind: 'income' as const, rows: this.incomeRows(), titleKey: 'categories.sections.income' }
  ]);

  protected readonly isEmpty = computed(
    () =>
      !this.categoryGroupsResource.isLoading() &&
      !this.categoriesResource.isLoading() &&
      this.incomeRows().length === 0 &&
      this.expenseRows().length === 0
  );

  protected openCreateGroup(): void {
    this.formMode.set('group');
    this.editingGroup.set(undefined);
    this.editingCategory.set(undefined);
    this.presetGroup.set(undefined);
    this.formOpen.set(true);
  }

  protected openEditGroup(group: CategoryGroup): void {
    this.formMode.set('group');
    this.editingGroup.set(group);
    this.editingCategory.set(undefined);
    this.presetGroup.set(undefined);
    this.formOpen.set(true);
  }

  protected openCreateCategory(): void {
    this.formMode.set('category');
    this.editingCategory.set(undefined);
    this.editingGroup.set(undefined);
    this.presetGroup.set(undefined);
    this.formOpen.set(true);
  }

  protected openCreateCategoryIn(group: CategoryGroup): void {
    this.formMode.set('category');
    this.editingCategory.set(undefined);
    this.editingGroup.set(undefined);
    this.presetGroup.set(group);
    this.formOpen.set(true);
  }

  protected openEditCategory(category: Category): void {
    this.formMode.set('category');
    this.editingCategory.set(category);
    this.editingGroup.set(undefined);
    this.presetGroup.set(undefined);
    this.formOpen.set(true);
  }

  protected toggleCollapsed(group: CategoryGroup): void {
    this.collapseService.toggle(group.id);
  }

  protected isCollapsed(group: CategoryGroup): boolean {
    return this.collapseService.isCollapsed(group.id);
  }

  protected onSaved(): void {
    this.categoryGroupsResource.reload();
    this.categoriesResource.reload();
  }

  protected async deleteGroup(group: CategoryGroup): Promise<void> {
    const categories = this.categoriesResource.value() ?? [];
    const usage = categoryGroupUsage(group.id, categories);
    if (!isCategoryGroupDeletable(usage)) return;

    const confirmed = await this.confirmService.confirm(
      'categories.deleteGroup.title',
      'categories.deleteGroup.message',
      'danger',
      { name: group.name }
    );
    if (!confirmed) return;

    this.categoryGroupRepository.delete(group.id).subscribe({
      next: () => this.categoryGroupsResource.reload(),
      error: () => this.mutationErrors.show()
    });
  }

  protected async deleteCategory(category: Category): Promise<void> {
    const transactions = this.transactionsResource.value() ?? [];
    const usage = categoryUsage(category.id, transactions);

    if (isCategoryDeletable(usage)) {
      const confirmed = await this.confirmService.confirm(
        'categories.delete.title',
        'categories.delete.message',
        'danger',
        { name: category.name }
      );
      if (!confirmed) return;
      this.categoryRepository.delete(category.id).subscribe({
        next: () => this.categoriesResource.reload(),
        error: () => this.mutationErrors.show()
      });
      return;
    }

    await this.confirmService.confirm(
      'categories.delete.blockedTitle',
      'categories.delete.blockedMessage',
      'default',
      { transactions: usage.transactions }
    );
  }

  protected onGroupDrop(kind: CategoryKind, event: CdkDragDrop<GroupRow[]>): void {
    if (event.previousIndex === event.currentIndex) return;
    const rows = kind === 'income' ? this.incomeRows() : this.expenseRows();
    const orderedIds = rows.map((row) => row.group.id);
    moveItemInArray(orderedIds, event.previousIndex, event.currentIndex);
    this.categoryGroupRepository.reorder(kind, orderedIds).subscribe({
      next: () => this.categoryGroupsResource.reload(),
      error: () => this.mutationErrors.show()
    });
  }

  protected onCategoryDrop(kind: CategoryKind, groupId: string, event: CdkDragDrop<CategoryRow[]>): void {
    if (event.previousIndex === event.currentIndex) return;
    const rows = kind === 'income' ? this.incomeRows() : this.expenseRows();
    const group = rows.find((row) => row.group.id === groupId);
    if (!group) return;
    const orderedIds = group.categories.map((row) => row.category.id);
    moveItemInArray(orderedIds, event.previousIndex, event.currentIndex);
    this.categoryRepository.reorder(kind, groupId, orderedIds).subscribe({
      next: () => this.categoriesResource.reload(),
      error: () => this.mutationErrors.show()
    });
  }
}
