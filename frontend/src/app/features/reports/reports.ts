import { Component, computed, inject, signal } from '@angular/core';
import { rxResource, toSignal } from '@angular/core/rxjs-interop';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { TranslocoLocaleService } from '@jsverse/transloco-locale';
import { ThemeService } from '../../core/theme.service';
import { AccountRepository } from '../../data/account.repository';
import { CategoryRepository } from '../../data/category.repository';
import { TransactionRepository } from '../../data/transaction.repository';
import { accountBalance } from '../../domain/calc/balances';
import { categoryBreakdown, totalsFor } from '../../domain/calc/aggregations';
import { Account } from '../../domain/models/account';
import { compare, Money, toNumber } from '../../shared/money/money';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { categoryColorMap, resolveCssColor } from '../../shared/charts/chart-palette';
import { formatIsoDate } from '../../domain/calc/dates';
import { Chart, ChartDataset } from '../../shared/charts/chart';
import { Card } from '../../shared/ui/card/card';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { MonthBucket, ReportPeriod, resolveMonthBuckets } from './report-period';

const DISPLAY_CURRENCY = 'BRL';
const PERIOD_OPTIONS: readonly ReportPeriod[] = ['month', '3m', '6m', '12m', 'custom'];

interface CategoryTableRow {
  categoryId: string;
  name: string;
  color: string;
  total: Money;
  percent: number;
}

@Component({
  selector: 'app-reports',
  imports: [TranslocoDirective, MoneyPipe, Card, EmptyState, PageHeader, Chart],
  templateUrl: './reports.html',
  styleUrl: './reports.scss'
})
export class Reports {
  private readonly accountRepository = inject(AccountRepository);
  private readonly categoryRepository = inject(CategoryRepository);
  private readonly transactionRepository = inject(TransactionRepository);
  private readonly theme = inject(ThemeService);
  private readonly localeService = inject(TranslocoLocaleService);
  private readonly transloco = inject(TranslocoService);
  // Chart dataset/legend labels are built here in the component (Chart.js
  // reads plain strings, not template bindings), so they need an explicit
  // reactive read of the active language — a signal, not a one-off
  // `.translate()` call, so these computed signals re-run on a language
  // switch instead of only on their other dependencies.
  private readonly lang = toSignal(this.transloco.langChanges$, {
    initialValue: this.transloco.getActiveLang()
  });

  protected readonly periodOptions = PERIOD_OPTIONS;
  protected readonly period = signal<ReportPeriod>('6m');
  protected readonly customFrom = signal('');
  protected readonly customTo = signal('');

  protected readonly accountsResource = rxResource({ stream: () => this.accountRepository.list() });
  protected readonly categoriesResource = rxResource({ stream: () => this.categoryRepository.list() });
  protected readonly transactionsResource = rxResource({
    stream: () => this.transactionRepository.list()
  });

  protected readonly formatMoney = (value: number): string =>
    this.localeService.localizeNumber(String(value), 'currency', undefined, {
      currency: DISPLAY_CURRENCY,
      currencyDisplay: 'symbol'
    });

  protected readonly buckets = computed<MonthBucket[]>(() =>
    resolveMonthBuckets(this.period(), this.customFrom(), this.customTo(), this.localeService.getLocale())
  );

  private readonly transactionsInRange = computed(() => {
    const buckets = this.buckets();
    if (buckets.length === 0) return [];
    const from = buckets[0].key;
    const to = buckets.at(-1)!.key;
    return (this.transactionsResource.value() ?? []).filter((tx) => {
      const key = tx.date.slice(0, 7);
      return key >= from && key <= to;
    });
  });

  protected readonly isEmpty = computed(
    () => !this.transactionsResource.isLoading() && this.transactionsInRange().length === 0
  );

  protected readonly incomeExpenseChart = computed(() => {
    this.theme.current(); // re-resolve --positive/--negative on toggle
    this.lang();
    const buckets = this.buckets();
    const transactions = this.transactionsResource.value() ?? [];
    const income: number[] = [];
    const expense: number[] = [];

    for (const bucket of buckets) {
      const inBucket = transactions.filter((tx) => tx.date.slice(0, 7) === bucket.key);
      const totals = totalsFor(inBucket, DISPLAY_CURRENCY);
      income.push(toNumber(totals.income));
      expense.push(toNumber(totals.expense));
    }

    const datasets: ChartDataset[] = [
      { label: this.transloco.translate('reports.series.income'), data: income, color: resolveCssColor('--positive') },
      { label: this.transloco.translate('reports.series.expense'), data: expense, color: resolveCssColor('--negative') }
    ];
    return { labels: buckets.map((b) => b.label), datasets };
  });

  protected readonly netFlowChart = computed(() => {
    this.theme.current(); // re-resolve --accent on toggle
    this.lang();
    const buckets = this.buckets();
    const transactions = this.transactionsResource.value() ?? [];
    const net = buckets.map((bucket) => {
      const inBucket = transactions.filter((tx) => tx.date.slice(0, 7) === bucket.key);
      return toNumber(totalsFor(inBucket, DISPLAY_CURRENCY).net);
    });

    const datasets: ChartDataset[] = [
      { label: this.transloco.translate('reports.series.netFlow'), data: net, color: resolveCssColor('--accent') }
    ];
    return { labels: buckets.map((b) => b.label), datasets };
  });

  private readonly stableExpenseCategoryIds = computed(() =>
    (this.categoriesResource.value() ?? [])
      .filter((c) => c.kind === 'expense' && !c.parentId)
      .map((c) => c.id)
  );

  protected readonly categoryTable = computed<CategoryTableRow[]>(() => {
    const categories = this.categoriesResource.value() ?? [];
    const transactions = this.transactionsInRange();
    const breakdown = categoryBreakdown(transactions, categories, DISPLAY_CURRENCY);
    const colorMap = categoryColorMap(this.stableExpenseCategoryIds(), this.theme.current());
    const byId = new Map(categories.map((c) => [c.id, c]));
    const grandTotal = breakdown.reduce((total, entry) => total + toNumber(entry.total), 0);

    return breakdown
      .map((entry) => ({
        categoryId: entry.categoryId,
        name: byId.get(entry.categoryId)?.name ?? entry.categoryId,
        color: colorMap.get(entry.categoryId) ?? resolveCssColor('--content-subtle'),
        total: entry.total,
        percent: grandTotal > 0 ? (toNumber(entry.total) / grandTotal) * 100 : 0
      }))
      .sort((a, b) => compare(b.total, a.total));
  });

  protected readonly categoryChart = computed(() => {
    this.lang();
    const rows = this.categoryTable();
    const datasets: ChartDataset[] = [
      {
        label: this.transloco.translate('reports.series.categories'),
        data: rows.map((row) => toNumber(row.total)),
        colors: rows.map((row) => row.color)
      }
    ];
    return { labels: rows.map((row) => row.name), datasets };
  });

  private readonly stableAccountIds = computed(() =>
    (this.accountsResource.value() ?? []).filter((a) => !a.archived).map((a) => a.id)
  );

  protected readonly balanceTrendChart = computed(() => {
    const buckets = this.buckets();
    const accounts = (this.accountsResource.value() ?? []).filter((a) => !a.archived);
    const allTransactions = this.transactionsResource.value() ?? [];
    const colorMap = categoryColorMap(this.stableAccountIds(), this.theme.current());

    const datasets: ChartDataset[] = accounts.map((account: Account) => ({
      label: account.name,
      color: colorMap.get(account.id),
      data: buckets.map((bucket) => {
        const bucketEndIso = formatIsoDate(bucket.end);
        const upToBucketEnd = allTransactions.filter((tx) => tx.date <= bucketEndIso);
        return toNumber(accountBalance(account, upToBucketEnd));
      })
    }));

    return { labels: buckets.map((b) => b.label), datasets };
  });

  protected onPeriodChange(value: string): void {
    this.period.set(value as ReportPeriod);
  }
}
