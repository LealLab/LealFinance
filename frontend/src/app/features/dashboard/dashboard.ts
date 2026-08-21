import { Component, computed, inject } from '@angular/core';
import { rxResource, toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { TranslocoLocaleService } from '@jsverse/transloco-locale';
import { forkJoin, of } from 'rxjs';
import { DisplayCurrencyService } from '../../core/display-currency.service';
import { ThemeService } from '../../core/theme.service';
import { AccountRepository } from '../../data/account.repository';
import { BudgetRepository } from '../../data/budget.repository';
import { CategoryRepository } from '../../data/category.repository';
import { ExchangeRateRepository } from '../../data/exchange-rate.repository';
import { TransactionRepository } from '../../data/transaction.repository';
import {
  categoryBreakdown,
  converterFromRates,
  CurrencyConverter,
  netWorth,
  totalsFor
} from '../../domain/calc/aggregations';
import { budgetProgress } from '../../domain/calc/budgets';
import { addMonthsClamped, formatIsoDate, monthKey } from '../../domain/calc/dates';
import { Account } from '../../domain/models/account';
import { ExchangeRate } from '../../domain/models/exchange-rate';
import { compare, isNegative, isZero, money, Money, ratio, toNumber, zero } from '../../shared/money/money';
import { categoryColorMap, resolveCssColor } from '../../shared/charts/chart-palette';
import { Chart, ChartDataset } from '../../shared/charts/chart';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { ExchangeRateWarning } from '../../shared/exchange-rate-warning/exchange-rate-warning';
import { Card } from '../../shared/ui/card/card';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { ProgressBar } from '../../shared/ui/progress-bar/progress-bar';
import { StatTile } from '../../shared/ui/stat-tile/stat-tile';

const CASH_FLOW_MONTHS = 6;
const RECENT_TRANSACTIONS_LIMIT = 5;
const BUDGET_PREVIEW_LIMIT = 4;

@Component({
  selector: 'app-dashboard',
  imports: [
    TranslocoDirective,
    MoneyPipe,
    Card,
    EmptyState,
    PageHeader,
    ProgressBar,
    StatTile,
    Chart,
    ExchangeRateWarning
  ],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss'
})
export class Dashboard {
  private readonly router = inject(Router);
  private readonly accountRepository = inject(AccountRepository);
  private readonly transactionRepository = inject(TransactionRepository);
  private readonly categoryRepository = inject(CategoryRepository);
  private readonly budgetRepository = inject(BudgetRepository);
  private readonly exchangeRateRepository = inject(ExchangeRateRepository);
  protected readonly displayCurrencyService = inject(DisplayCurrencyService);
  private readonly theme = inject(ThemeService);
  private readonly transloco = inject(TranslocoService);
  private readonly localeService = inject(TranslocoLocaleService);
  private readonly lang = toSignal(this.transloco.langChanges$, {
    initialValue: this.transloco.getActiveLang()
  });

  // The dashboard only ever shows the current month (totals, category
  // breakdown, budget preview) and a CASH_FLOW_MONTHS-wide trend - never
  // the full ledger. Net worth and per-account balances instead come from
  // accountRepository.balances(), which covers all-time history server-side.
  private readonly windowStartDate: string = formatIsoDate(
    addMonthsClamped(
      new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)),
      -(CASH_FLOW_MONTHS - 1)
    )
  );

  protected readonly accountsResource = rxResource({ stream: () => this.accountRepository.list() });
  protected readonly balancesResource = rxResource({
    stream: () => this.accountRepository.balances()
  });
  protected readonly transactionsResource = rxResource({
    stream: () => this.transactionRepository.list({ dateFrom: this.windowStartDate })
  });
  protected readonly categoriesResource = rxResource({ stream: () => this.categoryRepository.list() });
  protected readonly budgetsResource = rxResource({ stream: () => this.budgetRepository.list() });

  protected readonly displayCurrency = this.displayCurrencyService.currency;

  private readonly foreignCurrencies = computed(() => {
    const display = this.displayCurrency();
    const accounts = this.accountsResource.value() ?? [];
    return Array.from(
      new Set(accounts.filter((a) => !a.archived && a.currency !== display).map((a) => a.currency))
    );
  });

  protected readonly exchangeRatesResource = rxResource({
    params: () => ({ currencies: this.foreignCurrencies(), display: this.displayCurrency() }),
    stream: ({ params }) => {
      if (params.currencies.length === 0) return of([] as ExchangeRate[]);
      return forkJoin(
        params.currencies.map((currency) => this.exchangeRateRepository.getRate(currency, params.display))
      );
    }
  });

  protected readonly hasFallbackRate = computed(() =>
    (this.exchangeRatesResource.value() ?? []).some((rate) => rate.isFallback)
  );

  private readonly converter = computed<CurrencyConverter>(() =>
    converterFromRates(this.exchangeRatesResource.value() ?? [])
  );

  private readonly currentMonth = monthKey(new Date().toISOString());

  private readonly currentMonthTransactions = computed(() =>
    (this.transactionsResource.value() ?? []).filter(
      (tx) => monthKey(tx.date) === this.currentMonth
    )
  );

  protected readonly netWorth = computed(() =>
    netWorth(
      this.accountsResource.value() ?? [],
      this.balancesResource.value() ?? [],
      this.displayCurrency(),
      this.converter()
    )
  );

  protected readonly monthTotals = computed(() =>
    totalsFor(this.currentMonthTransactions(), this.displayCurrency(), this.converter())
  );

  protected readonly savingsRate = computed(() => {
    const totals = this.monthTotals();
    if (isZero(totals.income)) return 0;
    return Math.max(0, ratio(totals.net, totals.income)) * 100;
  });

  protected readonly cashFlowChart = computed(() => {
    this.theme.current();
    this.lang();
    const transactions = this.transactionsResource.value() ?? [];
    const today = new Date();
    const start = addMonthsClamped(
      new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)),
      -(CASH_FLOW_MONTHS - 1)
    );

    const labels: string[] = [];
    const income: number[] = [];
    const expense: number[] = [];
    const monthFormatter = new Intl.DateTimeFormat(this.localeService.getLocale(), {
      month: 'short',
      timeZone: 'UTC'
    });

    for (let i = 0; i < CASH_FLOW_MONTHS; i++) {
      const monthStart = addMonthsClamped(start, i);
      const key = monthKey(formatIsoDate(monthStart));
      labels.push(monthFormatter.format(monthStart).replace('.', ''));
      const inMonth = transactions.filter((tx) => monthKey(tx.date) === key);
      const totals = totalsFor(inMonth, this.displayCurrency(), this.converter());
      income.push(toNumber(totals.income));
      expense.push(toNumber(totals.expense));
    }

    const datasets: ChartDataset[] = [
      { label: this.transloco.translate('dashboard.cashFlow.income'), data: income, color: resolveCssColor('--positive') },
      { label: this.transloco.translate('dashboard.cashFlow.expense'), data: expense, color: resolveCssColor('--negative') }
    ];
    return { labels, datasets };
  });

  protected readonly categoryChart = computed(() => {
    this.theme.current();
    this.lang();
    const categories = this.categoriesResource.value() ?? [];
    const breakdown = categoryBreakdown(
      this.currentMonthTransactions(),
      categories,
      this.displayCurrency(),
      this.converter()
    );
    const stableIds = categories.filter((c) => c.kind === 'expense' && !c.parentId).map((c) => c.id);
    const colorMap = categoryColorMap(stableIds, this.theme.current());
    const byId = new Map(categories.map((c) => [c.id, c]));
    const sorted = [...breakdown].sort((a, b) => compare(b.total, a.total));

    const datasets: ChartDataset[] = [
      {
        label: this.transloco.translate('dashboard.categoryChart.label'),
        data: sorted.map((entry) => toNumber(entry.total)),
        colors: sorted.map((entry) => colorMap.get(entry.categoryId) ?? resolveCssColor('--content-subtle'))
      }
    ];
    return {
      labels: sorted.map((entry) => byId.get(entry.categoryId)?.name ?? entry.categoryId),
      datasets
    };
  });

  protected readonly hasCategorySpend = computed(() => this.categoryChart().labels.length > 0);

  protected readonly formatMoney = (value: number): string =>
    this.localeService.localizeNumber(String(value), 'currency', undefined, {
      currency: this.displayCurrency(),
      currencyDisplay: 'symbol'
    });

  protected readonly accountRows = computed(() => {
    const accounts = (this.accountsResource.value() ?? []).filter((a) => !a.archived);
    const balanceByAccountId = new Map(
      (this.balancesResource.value() ?? []).map((b) => [b.accountId, b])
    );
    return accounts
      .map((account) => {
        const row = balanceByAccountId.get(account.id);
        const balance = row ? money(row.balance, row.currency) : zero(account.currency);
        return { account, balance };
      })
      .sort((a, b) => (isNegative(a.balance) ? 1 : 0) - (isNegative(b.balance) ? 1 : 0));
  });

  protected readonly recentTransactions = computed(() => {
    const accounts = new Map((this.accountsResource.value() ?? []).map((a: Account) => [a.id, a]));
    return (this.transactionsResource.value() ?? [])
      .filter((tx) => tx.type !== 'interest')
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
      .slice(0, RECENT_TRANSACTIONS_LIMIT)
      .map((tx) => ({ tx, account: accounts.get(tx.accountId) }));
  });

  protected amountClass(value: Money): string {
    if (isZero(value)) return 'text-content-primary';
    return isNegative(value) ? 'text-negative' : 'text-positive';
  }

  protected transactionClass(tx: { type: string; amount: string; currency: string }): string {
    if (isZero(money(tx.amount, tx.currency))) return 'text-content-primary';
    if (tx.type === 'transfer') return 'text-accent';
    if (tx.type === 'income') return 'text-positive';
    if (tx.type === 'expense') return 'text-negative';
    return 'text-content-primary';
  }

  protected readonly budgetPreview = computed(() => {
    const budgets = (this.budgetsResource.value() ?? []).filter((b) => b.month === this.currentMonth);
    const categories = this.categoriesResource.value() ?? [];
    const transactions = this.transactionsResource.value() ?? [];
    const byId = new Map(categories.map((c) => [c.id, c]));

    return budgets
      .map((budget) => ({
        ...budgetProgress(budget, transactions, categories, this.converter()),
        categoryName: byId.get(budget.categoryId)?.name ?? budget.categoryId
      }))
      .sort((a, b) => b.ratio - a.ratio)
      .slice(0, BUDGET_PREVIEW_LIMIT);
  });

  protected readonly isEmpty = computed(
    () => !this.accountsResource.isLoading() && (this.accountsResource.value() ?? []).length === 0
  );

  protected goToExchange(): void {
    this.router.navigate(['/exchange']);
  }
}
