import { Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { TranslocoDirective } from '@jsverse/transloco';
import { CategoryRepository } from '../../data/category.repository';
import { TransactionRepository } from '../../data/transaction.repository';
import { monthKey } from '../../domain/calc/dates';
import { Category, CategoryKind } from '../../domain/models/category';
import { add, Money, money, zero } from '../../shared/money/money';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { Badge } from '../../shared/ui/badge/badge';
import { Button } from '../../shared/ui/button/button';
import { Card } from '../../shared/ui/card/card';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { Icon } from '../../shared/ui/icon/icon';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { CategoryFormModal } from './category-form-modal';

const DISPLAY_CURRENCY = 'BRL';

interface CategoryRow {
  category: Category;
  spend: Money;
  children: CategoryRow[];
}

@Component({
  selector: 'app-categories',
  imports: [
    TranslocoDirective,
    MoneyPipe,
    Badge,
    Button,
    Card,
    EmptyState,
    Icon,
    PageHeader,
    CategoryFormModal
  ],
  templateUrl: './categories.html',
  styleUrl: './categories.scss'
})
export class Categories {
  private readonly categoryRepository = inject(CategoryRepository);
  private readonly transactionRepository = inject(TransactionRepository);

  protected readonly categoriesResource = rxResource({ stream: () => this.categoryRepository.list() });
  protected readonly transactionsResource = rxResource({
    stream: () => this.transactionRepository.list()
  });

  protected readonly showArchived = signal(false);
  protected readonly formOpen = signal(false);
  protected readonly editingCategory = signal<Category | undefined>(undefined);

  private readonly spendByCategory = computed<Map<string, Money>>(() => {
    const currentMonth = monthKey(new Date().toISOString());
    const transactions = this.transactionsResource.value() ?? [];
    const categories = this.categoriesResource.value() ?? [];
    const kindById = new Map(categories.map((c) => [c.id, c.kind]));

    const totals = new Map<string, Money>();
    for (const tx of transactions) {
      if (!tx.categoryId || monthKey(tx.date) !== currentMonth) continue;
      const kind = kindById.get(tx.categoryId);
      if (!kind || tx.type !== kind) continue;
      const current = totals.get(tx.categoryId) ?? zero(DISPLAY_CURRENCY);
      totals.set(tx.categoryId, add(current, money(tx.amount, DISPLAY_CURRENCY)));
    }
    return totals;
  });

  private buildRows(kind: CategoryKind): CategoryRow[] {
    const categories = this.categoriesResource.value() ?? [];
    const spend = this.spendByCategory();
    const showArchived = this.showArchived();

    const parents = categories.filter(
      (c) => c.kind === kind && !c.parentId && (showArchived || !c.archived)
    );

    return parents.map((parent) => {
      const children = categories
        .filter((c) => c.parentId === parent.id && (showArchived || !c.archived))
        .map((child) => ({ category: child, spend: spend.get(child.id) ?? zero(DISPLAY_CURRENCY), children: [] }));

      const ownSpend = spend.get(parent.id) ?? zero(DISPLAY_CURRENCY);
      const rolledUp = children.reduce((total, row) => add(total, row.spend), ownSpend);

      return { category: parent, spend: rolledUp, children };
    });
  }

  protected readonly incomeRows = computed(() => this.buildRows('income'));
  protected readonly expenseRows = computed(() => this.buildRows('expense'));

  /**
   * A plain array (not built inline in the template) so each section's
   * translation key is a property path the extractor can follow — see
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
      !this.categoriesResource.isLoading() &&
      this.incomeRows().length === 0 &&
      this.expenseRows().length === 0
  );

  protected openCreate(): void {
    this.editingCategory.set(undefined);
    this.formOpen.set(true);
  }

  protected openEdit(category: Category): void {
    this.editingCategory.set(category);
    this.formOpen.set(true);
  }

  protected toggleArchived(category: Category): void {
    this.categoryRepository.setArchived(category.id, !category.archived).subscribe(() => {
      this.categoriesResource.reload();
    });
  }

  protected onSaved(): void {
    this.categoriesResource.reload();
  }
}
