import { Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { TranslocoDirective } from '@jsverse/transloco';
import { ConfirmService } from '../../core/confirm.service';
import { BudgetRepository } from '../../data/budget.repository';
import { CategoryRepository } from '../../data/category.repository';
import { TransactionRepository } from '../../data/transaction.repository';
import { BudgetProgress, budgetProgress, UnbudgetedSpend, unbudgetedSpend } from '../../domain/calc/budgets';
import { monthKey } from '../../domain/calc/dates';
import { Budget } from '../../domain/models/budget';
import { Category } from '../../domain/models/category';
import { subtract, sum } from '../../shared/money/money';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { Badge } from '../../shared/ui/badge/badge';
import { Button } from '../../shared/ui/button/button';
import { Card } from '../../shared/ui/card/card';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { Icon } from '../../shared/ui/icon/icon';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { ProgressBar } from '../../shared/ui/progress-bar/progress-bar';
import { StatTile } from '../../shared/ui/stat-tile/stat-tile';
import { BudgetFormModal } from './budget-form-modal';

const DISPLAY_CURRENCY = 'BRL';

interface BudgetRow extends BudgetProgress {
  budget: Budget;
  category: Category | undefined;
}

/**
 * The literal keys passed to `confirmService.confirm(...)` below are real
 * string literals, but the call itself isn't to the `t` marker function,
 * so transloco-keys-manager's extractor never sees them — same "dynamic
 * markings" situation as transactions.ts:
 * t(budgets.delete.title, budgets.delete.message)
 */
@Component({
  selector: 'app-budgets',
  imports: [
    TranslocoDirective,
    MoneyPipe,
    Badge,
    Button,
    Card,
    EmptyState,
    Icon,
    PageHeader,
    ProgressBar,
    StatTile,
    BudgetFormModal
  ],
  templateUrl: './budgets.html',
  styleUrl: './budgets.scss'
})
export class Budgets {
  private readonly budgetRepository = inject(BudgetRepository);
  private readonly categoryRepository = inject(CategoryRepository);
  private readonly transactionRepository = inject(TransactionRepository);
  private readonly confirmService = inject(ConfirmService);

  protected readonly budgetsResource = rxResource({ stream: () => this.budgetRepository.list() });
  protected readonly categoriesResource = rxResource({ stream: () => this.categoryRepository.list() });
  protected readonly transactionsResource = rxResource({
    stream: () => this.transactionRepository.list()
  });

  protected readonly selectedMonth = signal(monthKey(new Date().toISOString()));

  private readonly categoriesById = computed(
    () => new Map(this.categoriesResource.value()?.map((c) => [c.id, c]) ?? [])
  );

  protected readonly budgetRows = computed<BudgetRow[]>(() => {
    const budgets = this.budgetsResource.value() ?? [];
    const categories = this.categoriesResource.value() ?? [];
    const transactions = this.transactionsResource.value() ?? [];
    const month = this.selectedMonth();
    const byId = this.categoriesById();

    return budgets
      .filter((budget) => budget.month === month)
      .map((budget) => ({
        ...budgetProgress(budget, transactions, categories),
        budget,
        category: byId.get(budget.categoryId)
      }))
      .sort((a, b) => (a.category?.name ?? '').localeCompare(b.category?.name ?? ''));
  });

  protected readonly unbudgetedRows = computed<(UnbudgetedSpend & { category: Category | undefined })[]>(
    () => {
      const transactions = this.transactionsResource.value() ?? [];
      const categories = this.categoriesResource.value() ?? [];
      const budgets = this.budgetsResource.value() ?? [];
      const byId = this.categoriesById();

      return unbudgetedSpend(transactions, categories, budgets, this.selectedMonth(), DISPLAY_CURRENCY).map(
        (entry) => ({ ...entry, category: byId.get(entry.categoryId) })
      );
    }
  );

  protected readonly totals = computed(() => {
    const rows = this.budgetRows();
    const budgeted = sum(
      rows.map((r) => r.budgeted),
      DISPLAY_CURRENCY
    );
    const spent = sum(
      rows.map((r) => r.spent),
      DISPLAY_CURRENCY
    );
    return { budgeted, spent, remaining: subtract(budgeted, spent) };
  });

  protected readonly availableCategoriesForNewBudget = computed<Category[]>(() => {
    const categories = this.categoriesResource.value() ?? [];
    const budgetedIds = new Set(
      (this.budgetsResource.value() ?? [])
        .filter((b) => b.month === this.selectedMonth())
        .map((b) => b.categoryId)
    );
    return categories.filter((c) => c.kind === 'expense' && !c.parentId && !c.archived && !budgetedIds.has(c.id));
  });

  protected readonly isEmpty = computed(
    () =>
      !this.budgetsResource.isLoading() &&
      this.budgetRows().length === 0 &&
      this.unbudgetedRows().length === 0
  );

  protected readonly formOpen = signal(false);
  protected readonly editingBudget = signal<Budget | undefined>(undefined);
  protected readonly prefillCategoryId = signal<string | undefined>(undefined);

  protected onMonthChange(value: string): void {
    if (value) this.selectedMonth.set(value);
  }

  protected openCreate(): void {
    this.editingBudget.set(undefined);
    this.prefillCategoryId.set(undefined);
    this.formOpen.set(true);
  }

  protected openCreateFor(categoryId: string): void {
    this.editingBudget.set(undefined);
    this.prefillCategoryId.set(categoryId);
    this.formOpen.set(true);
  }

  protected openEdit(budget: Budget): void {
    this.editingBudget.set(budget);
    this.prefillCategoryId.set(undefined);
    this.formOpen.set(true);
  }

  protected onSaved(): void {
    this.budgetsResource.reload();
  }

  protected async deleteBudget(budget: Budget): Promise<void> {
    const confirmed = await this.confirmService.confirm(
      'budgets.delete.title',
      'budgets.delete.message',
      'danger'
    );
    if (!confirmed) return;
    this.budgetRepository.delete(budget.id).subscribe(() => this.budgetsResource.reload());
  }
}
