import { Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { forkJoin, of } from 'rxjs';
import { ConfirmService } from '../../core/confirm.service';
import { DisplayCurrencyService } from '../../core/display-currency.service';
import { MutationErrorService } from '../../core/mutation-error.service';
import { openOnNewParam } from '../../core/open-on-new-param';
import { PreferenceService } from '../../core/preference.service';
import { ThemeService } from '../../core/theme.service';
import { BudgetRepository } from '../../data/budget.repository';
import { BudgetPlanRepository } from '../../data/budget-plan.repository';
import { CategoryGroupRepository } from '../../data/category-group.repository';
import { CategoryRepository } from '../../data/category.repository';
import { TransactionRepository } from '../../data/transaction.repository';
import {
  allocationBudgets,
  allocationTotal,
  budgetPercentage,
} from '../../domain/calc/budget-plan';
import { effectiveAmount } from '../../domain/calc/conversion';
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
import { CategoryGroup } from '../../domain/models/category-group';
import { Transaction } from '../../domain/models/transaction';
import { isNegative, isZero, Money, subtract, sum } from '../../shared/money/money';
import { CurrencyConverter } from '../../domain/calc/aggregations';
import { pairsConverter } from '../../shared/money/display-converter';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
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
import { StatTile, StatTone } from '../../shared/ui/stat-tile/stat-tile';
import { BudgetFormModal } from './budget-form-modal';

/** t(budgets.planner.errors.total, budgets.planner.errors.income, budgets.planner.errors.save) */

interface BudgetRow extends BudgetProgress {
  budget: Budget;
  group: CategoryGroup | undefined;
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
    Skeleton,
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
  private readonly categoryGroupRepository = inject(CategoryGroupRepository);
  private readonly categoryRepository = inject(CategoryRepository);
  private readonly transactionRepository = inject(TransactionRepository);
  private readonly confirmService = inject(ConfirmService);
  protected readonly displayCurrencyService = inject(DisplayCurrencyService);
  private readonly preferences = inject(PreferenceService);
  private readonly transloco = inject(TranslocoService);
  private readonly theme = inject(ThemeService);

  protected readonly budgetsResource = rxResource({ stream: () => this.budgetRepository.list() });
  private readonly baseCurrency = computed(
    () => this.preferences.preferences()?.baseCurrency ?? 'USD',
  );
  protected readonly displayCurrency = this.displayCurrencyService.currency;
  protected readonly allocationsResource = rxResource({
    stream: () => this.budgetPlanRepository.listAllocations(),
  });
  protected readonly expectedIncomeResource = rxResource({
    stream: () => this.budgetPlanRepository.listExpectedIncome(),
  });
  protected readonly categoriesResource = rxResource({
    stream: () => this.categoryRepository.list(),
  });
  protected readonly categoryGroupsResource = rxResource({
    stream: () => this.categoryGroupRepository.list(),
  });
  protected readonly transactionsResource = rxResource({
    stream: () => this.transactionRepository.list(),
  });
  private readonly conversionPairs = computed<[string, string][]>(() => {
    const targets = new Set([
      this.displayCurrency(),
      ...(this.budgetsResource.value() ?? []).map((budget) => budget.currency),
      ...(this.expectedIncomeResource.value() ?? []).map((income) => income.currency),
    ]);
    const sources = new Set([
      ...(this.transactionsResource.value() ?? []).map(
        (transaction) => effectiveAmount(transaction).currency,
      ),
      ...(this.budgetsResource.value() ?? []).map((budget) => budget.currency),
    ]);
    return [...sources].flatMap((source) =>
      [...targets]
        .filter((target) => target !== source)
        .map((target) => [source, target] as [string, string]),
    );
  });
  // null until a rate covers every (source, target) pair conversionPairs
  // names - see pairsConverter's doc comment for why this gate exists:
  // budgetProgress/unbudgetedSpend feed the converted amount into sum(),
  // which throws on a currency mismatch, unlike convertedOrNull's tolerant
  // passthrough. Template gates the rows/totals on this too.
  private readonly converter = pairsConverter(() => this.conversionPairs()).converter;
  protected readonly ratesReady = computed(() => this.converter() !== null);

  protected readonly selectedMonth = signal(monthKey(new Date().toISOString()));
  private readonly percentageDraft = signal<Record<string, string>>({});
  protected readonly incomeDraft = signal('');
  protected readonly plannerError = signal<string | null>(null);

  constructor() {
    openOnNewParam(() => this.openCreate());
  }

  private readonly categoryGroupsById = computed(
    () => new Map(this.categoryGroupsResource.value()?.map((group) => [group.id, group]) ?? []),
  );

  private displayBudgetProgress(
    convert: CurrencyConverter,
    budget: Budget,
    transactions: Transaction[],
    categories: Category[],
  ): BudgetProgress {
    const progress = budgetProgress(budget, transactions, categories, convert);
    const budgeted = convert(progress.budgeted, this.displayCurrency());
    const spent = convert(progress.spent, this.displayCurrency());
    return { ...progress, budgeted, spent, remaining: subtract(budgeted, spent) };
  }

  protected readonly fixedBudgetRows = computed<BudgetRow[]>(() => {
    const convert = this.converter();
    if (!convert) return [];
    const budgets = this.budgetsResource.value() ?? [];
    const categories = this.categoriesResource.value() ?? [];
    const transactions = this.transactionsResource.value() ?? [];
    const month = this.selectedMonth();
    const byId = this.categoryGroupsById();

    return budgets
      .filter((budget) => budget.month === month)
      .map((budget) => ({
        ...this.displayBudgetProgress(convert, budget, transactions, categories),
        budget,
        group: byId.get(budget.groupId),
        isPercentage: false,
      }))
      .sort((a, b) => (a.group?.name ?? '').localeCompare(b.group?.name ?? ''));
  });

  protected readonly allocationRows = computed(() => {
    const groups = (this.categoryGroupsResource.value() ?? [])
      .filter((group) => group.kind === 'expense')
      .sort((a, b) => a.position - b.position);
    const fixedIds = new Set(this.fixedBudgetRows().map((row) => row.budget.groupId));
    return groups.map((group) => ({
      group,
      fixed: fixedIds.has(group.id),
      percentage: this.allocationValue(group.id),
    }));
  });

  protected readonly totalPercentage = computed(() =>
    allocationTotal(
      this.allocationRows().map((row) => ({
        id: row.group.id,
        groupId: row.group.id,
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
    const convert = this.converter();
    if (!convert) return [];
    const categories = this.categoriesResource.value() ?? [];
    const groups = this.categoryGroupsResource.value() ?? [];
    const allocations: BudgetAllocation[] = this.allocationRows()
      .filter((row) => !row.fixed && Number(row.percentage) > 0)
      .map((row) => ({
        id: row.group.id,
        groupId: row.group.id,
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
      ...this.displayBudgetProgress(convert, entry.budget, transactions, categories),
      budget: entry.budget,
      group: groups.find((group) => group.id === entry.groupId),
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
      rows.map((row) => row.group.id),
      this.theme.current(),
    );
    return {
      labels: rows.map((row) => row.group.name),
      datasets: [
        {
          label: this.transloco.translate('budgets.planner.chartLabel'),
          data: rows.map((row) => Number(row.percentage)),
          colors: rows.map((row) => colorMap.get(row.group.id) ?? resolveCssColor('--accent')),
        },
      ],
    };
  });

  protected readonly unbudgetedRows = computed<
    (UnbudgetedSpend & { group: CategoryGroup | undefined })[]
  >(() => {
    const convert = this.converter();
    if (!convert) return [];
    const transactions = this.transactionsResource.value() ?? [];
    const categories = this.categoriesResource.value() ?? [];
    const budgets = this.budgetRows().map((row) => row.budget);
    const byId = this.categoryGroupsById();

    return unbudgetedSpend(
      transactions,
      categories,
      budgets,
      this.selectedMonth(),
      this.displayCurrency(),
      convert,
    ).map((entry) => ({ ...entry, group: byId.get(entry.groupId) }));
  });

  protected readonly totals = computed(() => {
    const rows = this.budgetRows();
    const budgeted = sum(rows.map((r) => r.budgeted), this.displayCurrency());
    const spent = sum(rows.map((r) => r.spent), this.displayCurrency());
    return { budgeted, spent, remaining: subtract(budgeted, spent) };
  });

  protected valueTone(value: Money, expense = false): StatTone {
    if (isZero(value)) return 'default';
    return expense || isNegative(value) ? 'negative' : 'positive';
  }

  protected readonly availableGroupsForNewBudget = computed<CategoryGroup[]>(() => {
    const groups = this.categoryGroupsResource.value() ?? [];
    const budgetedIds = new Set(this.budgetRows().map((row) => row.budget.groupId));
    const allocatedIds = new Set(
      this.allocationRows()
        .filter((row) => Number(row.percentage) > 0)
        .map((row) => row.group.id),
    );
    return groups.filter(
      (group) =>
        group.kind === 'expense' &&
        !budgetedIds.has(group.id) &&
        !allocatedIds.has(group.id),
    );
  });

  protected readonly isEmpty = computed(
    () =>
      !this.budgetsResource.isLoading() &&
      this.ratesReady() &&
      this.budgetRows().length === 0 &&
      this.unbudgetedRows().length === 0,
  );

  protected readonly formOpen = signal(false);
  protected readonly editingBudget = signal<Budget | undefined>(undefined);
  protected readonly prefillGroupId = signal<string | undefined>(undefined);

  protected onMonthChange(value: string): void {
    if (value) {
      this.selectedMonth.set(value);
      this.incomeDraft.set('');
      this.plannerError.set(null);
    }
  }

  protected openCreate(): void {
    this.editingBudget.set(undefined);
    this.prefillGroupId.set(undefined);
    this.formOpen.set(true);
  }

  protected openCreateFor(groupId: string): void {
    this.editingBudget.set(undefined);
    this.prefillGroupId.set(groupId);
    this.formOpen.set(true);
  }

  protected openEdit(budget: Budget): void {
    this.editingBudget.set(budget);
    this.prefillGroupId.set(undefined);
    this.formOpen.set(true);
  }

  protected onSaved(): void {
    this.budgetsResource.reload();
  }

  protected allocationValue(groupId: string): string {
    const fixedBudget = this.budgetsResource
      .value()
      ?.find((budget) => budget.groupId === groupId && budget.month === this.selectedMonth());
    if (fixedBudget) {
      const percentage = budgetPercentage(fixedBudget, this.expectedIncome());
      return percentage.toFixed(2).replace(/\.00$/, '');
    }

    const draft = this.percentageDraft()[groupId];
    if (draft !== undefined) return draft;
    return (
      this.allocationsResource.value()?.find((allocation) => allocation.groupId === groupId)
        ?.percentage ?? '0'
    );
  }

  protected setAllocation(groupId: string, value: string): void {
    if (this.allocationRows().find((row) => row.group.id === groupId)?.fixed) return;

    const normalized = Math.max(0, Math.min(100, Number(value) || 0));
    this.percentageDraft.update((draft) => ({
      ...draft,
      [groupId]: normalized.toFixed(2).replace(/\.00$/, ''),
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
    const fixedGroupIds = new Set(
      this.allocationRows()
        .filter((row) => row.fixed)
        .map((row) => row.group.id),
    );
    const requests = [
      ...currentAllocations
        .filter((allocation) => fixedGroupIds.has(allocation.groupId))
        .map((allocation) => this.budgetPlanRepository.deleteAllocation(allocation.id)),
      ...this.allocationRows()
        .filter((row) => !row.fixed)
        .map((row) => {
          const percentage = row.percentage;
          const existing = currentAllocations.find(
            (allocation) => allocation.groupId === row.group.id,
          );
          if (Number(percentage) <= 0 && existing)
            return this.budgetPlanRepository.deleteAllocation(existing.id);
          if (Number(percentage) <= 0) return of(undefined);
          return this.budgetPlanRepository.upsertAllocation({
            groupId: row.group.id,
            percentage,
          });
        }),
    ];
    forkJoin([
      this.budgetPlanRepository.upsertExpectedIncome({
        month: this.selectedMonth(),
        amount: income,
        currency: this.expectedIncome()?.currency ?? this.baseCurrency(),
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
