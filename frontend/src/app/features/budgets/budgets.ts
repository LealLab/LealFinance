import { Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { forkJoin, of } from 'rxjs';
import { ConfirmService } from '../../core/confirm.service';
import { MutationErrorService } from '../../core/mutation-error.service';
import { ThemeService } from '../../core/theme.service';
import { BudgetRepository } from '../../data/budget.repository';
import { BudgetPlanRepository } from '../../data/budget-plan.repository';
import { CategoryRepository } from '../../data/category.repository';
import { TransactionRepository } from '../../data/transaction.repository';
import {
  allocationBudgets,
  allocationTotal,
  budgetPercentage,
} from '../../domain/calc/budget-plan';
import {
  BudgetProgress,
  budgetProgress,
  UnbudgetedSpend,
  unbudgetedSpend,
} from '../../domain/calc/budgets';
import { monthKey } from '../../domain/calc/dates';
import { Budget } from '../../domain/models/budget';
import { BudgetAllocation, ExpectedIncome } from '../../domain/models/budget-plan';
import { Category } from '../../domain/models/category';
import { subtract, sum } from '../../shared/money/money';
import { categoryColorMap, resolveCssColor } from '../../shared/charts/chart-palette';
import { Chart, ChartDataset } from '../../shared/charts/chart';
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

/** t(budgets.planner.errors.total, budgets.planner.errors.income, budgets.planner.errors.save) */

interface BudgetRow extends BudgetProgress {
  budget: Budget;
  category: Category | undefined;
  isPercentage: boolean;
  percentage?: string;
}

/**
 * The literal keys passed to `confirmService.confirm(...)` below are real
 * string literals, but the call itself isn't to the `t` marker function,
 * so transloco-keys-manager's extractor never sees them - same "dynamic
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
    BudgetFormModal,
    Chart,
  ],
  templateUrl: './budgets.html',
  styleUrl: './budgets.scss',
})
export class Budgets {
  private readonly mutationErrors = inject(MutationErrorService);
  private readonly budgetRepository = inject(BudgetRepository);
  private readonly budgetPlanRepository = inject(BudgetPlanRepository);
  private readonly categoryRepository = inject(CategoryRepository);
  private readonly transactionRepository = inject(TransactionRepository);
  private readonly confirmService = inject(ConfirmService);
  private readonly transloco = inject(TranslocoService);
  private readonly theme = inject(ThemeService);

  protected readonly budgetsResource = rxResource({ stream: () => this.budgetRepository.list() });
  protected readonly allocationsResource = rxResource({
    stream: () => this.budgetPlanRepository.listAllocations(),
  });
  protected readonly expectedIncomeResource = rxResource({
    stream: () => this.budgetPlanRepository.listExpectedIncome(),
  });
  protected readonly categoriesResource = rxResource({
    stream: () => this.categoryRepository.list(),
  });
  protected readonly transactionsResource = rxResource({
    stream: () => this.transactionRepository.list(),
  });

  protected readonly selectedMonth = signal(monthKey(new Date().toISOString()));
  private readonly percentageDraft = signal<Record<string, string>>({});
  protected readonly incomeDraft = signal('');
  protected readonly plannerError = signal<string | null>(null);

  private readonly categoriesById = computed(
    () => new Map(this.categoriesResource.value()?.map((c) => [c.id, c]) ?? []),
  );

  protected readonly fixedBudgetRows = computed<BudgetRow[]>(() => {
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
        category: byId.get(budget.categoryId),
        isPercentage: false,
      }))
      .sort((a, b) => (a.category?.name ?? '').localeCompare(b.category?.name ?? ''));
  });

  protected readonly allocationRows = computed(() => {
    const categories = (this.categoriesResource.value() ?? []).filter(
      (category) => category.kind === 'expense' && !category.parentId && !category.archived,
    );
    const fixedIds = new Set(this.fixedBudgetRows().map((row) => row.budget.categoryId));
    return categories.map((category) => ({
      category,
      fixed: fixedIds.has(category.id),
      percentage: this.allocationValue(category.id),
    }));
  });

  protected readonly totalPercentage = computed(() =>
    allocationTotal(
      this.allocationRows().map((row) => ({
        id: row.category.id,
        categoryId: row.category.id,
        percentage: row.percentage,
      })),
    ),
  );

  protected readonly expectedIncome = computed<ExpectedIncome | undefined>(() =>
    (this.expectedIncomeResource.value() ?? []).find(
      (income) => income.month === this.selectedMonth(),
    ),
  );

  protected readonly percentageBudgetRows = computed<BudgetRow[]>(() => {
    const categories = this.categoriesResource.value() ?? [];
    const allocations: BudgetAllocation[] = this.allocationRows()
      .filter((row) => !row.fixed && Number(row.percentage) > 0)
      .map((row) => ({
        id: row.category.id,
        categoryId: row.category.id,
        percentage: row.percentage,
      }));
    const budgets = allocationBudgets(
      categories,
      allocations,
      this.budgetsResource.value() ?? [],
      this.expectedIncome(),
      this.selectedMonth(),
    );
    const transactions = this.transactionsResource.value() ?? [];
    return budgets.map((entry) => ({
      ...budgetProgress(entry.budget, transactions, categories),
      budget: entry.budget,
      category: categories.find((category) => category.id === entry.categoryId),
      isPercentage: true,
      percentage: entry.percentage,
    }));
  });

  protected readonly budgetRows = computed(() => [
    ...this.fixedBudgetRows(),
    ...this.percentageBudgetRows(),
  ]);

  protected readonly plannerChart = computed<{ labels: string[]; datasets: ChartDataset[] }>(() => {
    this.theme.current();
    const rows = this.allocationRows().filter((row) => Number(row.percentage) > 0);
    const colorMap = categoryColorMap(
      rows.map((row) => row.category.id),
      this.theme.current(),
    );
    return {
      labels: rows.map((row) => row.category.name),
      datasets: [
        {
          label: this.transloco.translate('budgets.planner.chartLabel'),
          data: rows.map((row) => Number(row.percentage)),
          colors: rows.map((row) => colorMap.get(row.category.id) ?? resolveCssColor('--accent')),
        },
      ],
    };
  });

  protected readonly unbudgetedRows = computed<
    (UnbudgetedSpend & { category: Category | undefined })[]
  >(() => {
    const transactions = this.transactionsResource.value() ?? [];
    const categories = this.categoriesResource.value() ?? [];
    const budgets = this.budgetRows().map((row) => row.budget);
    const byId = this.categoriesById();

    return unbudgetedSpend(
      transactions,
      categories,
      budgets,
      this.selectedMonth(),
      DISPLAY_CURRENCY,
    ).map((entry) => ({ ...entry, category: byId.get(entry.categoryId) }));
  });

  protected readonly totals = computed(() => {
    const rows = this.budgetRows();
    const budgeted = sum(
      rows.map((r) => r.budgeted),
      DISPLAY_CURRENCY,
    );
    const spent = sum(
      rows.map((r) => r.spent),
      DISPLAY_CURRENCY,
    );
    return { budgeted, spent, remaining: subtract(budgeted, spent) };
  });

  protected readonly availableCategoriesForNewBudget = computed<Category[]>(() => {
    const categories = this.categoriesResource.value() ?? [];
    const budgetedIds = new Set(this.budgetRows().map((row) => row.budget.categoryId));
    const allocatedIds = new Set(
      this.allocationRows()
        .filter((row) => Number(row.percentage) > 0)
        .map((row) => row.category.id),
    );
    return categories.filter(
      (c) =>
        c.kind === 'expense' &&
        !c.parentId &&
        !c.archived &&
        !budgetedIds.has(c.id) &&
        !allocatedIds.has(c.id),
    );
  });

  protected readonly isEmpty = computed(
    () =>
      !this.budgetsResource.isLoading() &&
      this.budgetRows().length === 0 &&
      this.unbudgetedRows().length === 0,
  );

  protected readonly formOpen = signal(false);
  protected readonly editingBudget = signal<Budget | undefined>(undefined);
  protected readonly prefillCategoryId = signal<string | undefined>(undefined);

  protected onMonthChange(value: string): void {
    if (value) {
      this.selectedMonth.set(value);
      this.incomeDraft.set('');
      this.plannerError.set(null);
    }
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

  protected allocationValue(categoryId: string): string {
    const fixedBudget = this.budgetsResource
      .value()
      ?.find((budget) => budget.categoryId === categoryId && budget.month === this.selectedMonth());
    if (fixedBudget) {
      const percentage = budgetPercentage(fixedBudget, this.expectedIncome());
      return percentage.toFixed(2).replace(/\.00$/, '');
    }

    const draft = this.percentageDraft()[categoryId];
    if (draft !== undefined) return draft;
    return (
      this.allocationsResource.value()?.find((allocation) => allocation.categoryId === categoryId)
        ?.percentage ?? '0'
    );
  }

  protected setAllocation(categoryId: string, value: string): void {
    if (this.allocationRows().find((row) => row.category.id === categoryId)?.fixed) return;

    const normalized = Math.max(0, Math.min(100, Number(value) || 0));
    this.percentageDraft.update((draft) => ({
      ...draft,
      [categoryId]: normalized.toFixed(2).replace(/\.00$/, ''),
    }));
    this.plannerError.set(null);
  }

  protected incomeValue(): string {
    return this.incomeDraft() || this.expectedIncome()?.amount || '';
  }

  protected savePlanner(): void {
    if (this.totalPercentage() > 100.0001) {
      this.plannerError.set('budgets.planner.errors.total');
      return;
    }
    const income = this.incomeValue();
    if (!income) {
      this.plannerError.set('budgets.planner.errors.income');
      return;
    }
    const currentAllocations = this.allocationsResource.value() ?? [];
    const fixedCategoryIds = new Set(
      this.allocationRows()
        .filter((row) => row.fixed)
        .map((row) => row.category.id),
    );
    const requests = [
      ...currentAllocations
        .filter((allocation) => fixedCategoryIds.has(allocation.categoryId))
        .map((allocation) => this.budgetPlanRepository.deleteAllocation(allocation.id)),
      ...this.allocationRows()
        .filter((row) => !row.fixed)
        .map((row) => {
          const percentage = row.percentage;
          const existing = currentAllocations.find(
            (allocation) => allocation.categoryId === row.category.id,
          );
          if (Number(percentage) <= 0 && existing)
            return this.budgetPlanRepository.deleteAllocation(existing.id);
          if (Number(percentage) <= 0) return of(undefined);
          return this.budgetPlanRepository.upsertAllocation({
            categoryId: row.category.id,
            percentage,
          });
        }),
    ];
    forkJoin([
      this.budgetPlanRepository.upsertExpectedIncome({
        month: this.selectedMonth(),
        amount: income,
        currency: this.expectedIncome()?.currency ?? DISPLAY_CURRENCY,
      }),
      ...requests,
    ]).subscribe({
      next: () => {
        this.plannerError.set(null);
        this.incomeDraft.set('');
        this.allocationsResource.reload();
        this.expectedIncomeResource.reload();
        this.budgetsResource.reload();
      },
      error: () => this.plannerError.set('budgets.planner.errors.save'),
    });
  }

  protected async deleteBudget(budget: Budget): Promise<void> {
    const confirmed = await this.confirmService.confirm(
      'budgets.delete.title',
      'budgets.delete.message',
      'danger',
    );
    if (!confirmed) return;
    this.budgetRepository.delete(budget.id).subscribe({
      next: () => this.budgetsResource.reload(),
      error: () => this.mutationErrors.show(),
    });
  }
}
