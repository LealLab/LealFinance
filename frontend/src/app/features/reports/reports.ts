import { Component, computed, inject, signal } from '@angular/core';
import { rxResource, toSignal } from '@angular/core/rxjs-interop';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { TranslocoLocaleService } from '@jsverse/transloco-locale';
import { DisplayCurrencyService } from '../../core/display-currency.service';
import { ThemeService } from '../../core/theme.service';
import { AccountRepository } from '../../data/account.repository';
import { AnalyticsRepository } from '../../data/analytics.repository';
import { CategoryGroupRepository } from '../../data/category-group.repository';
import { Account } from '../../domain/models/account';
import { add, compare, money, Money, toNumber, zero } from '../../shared/money/money';
import { displayConverter } from '../../shared/money/display-converter';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { categoryColorMap, resolveCssColor } from '../../shared/charts/chart-palette';
import { formatIsoDate } from '../../domain/calc/dates';
import { Chart, ChartDataset } from '../../shared/charts/chart';
import { Card } from '../../shared/ui/card/card';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { ExchangeRateWarning } from '../../shared/exchange-rate-warning/exchange-rate-warning';
import { LoadError } from '../../shared/ui/load-error/load-error';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { MonthBucket, ReportPeriod, resolveMonthBuckets } from './report-period';

const PERIOD_OPTIONS: readonly ReportPeriod[] = ['month', '3m', '6m', '12m', 'custom'];

interface CategoryTableRow {
  groupId: string;
  name: string;
  color: string;
  total: Money;
  percent: number;
}

@Component({
  selector: 'app-reports',
  imports: [
    TranslocoDirective,
    MoneyPipe,
    Card,
    EmptyState,
    PageHeader,
    ExchangeRateWarning,
    Chart,
    Skeleton,
    LoadError,
  ],
  templateUrl: './reports.html',
})
export class Reports {
  private readonly accountRepository = inject(AccountRepository);
  private readonly analyticsRepository = inject(AnalyticsRepository);
  private readonly categoryGroupRepository = inject(CategoryGroupRepository);
  private readonly theme = inject(ThemeService);
  protected readonly displayCurrencyService = inject(DisplayCurrencyService);
  private readonly localeService = inject(TranslocoLocaleService);
  private readonly transloco = inject(TranslocoService);
  // Chart dataset/legend labels are built here in the component (Chart.js
  // reads plain strings, not template bindings), so they need an explicit
  // reactive read of the active language - a signal, not a one-off
  // `.translate()` call, so these computed signals re-run on a language
  // switch instead of only on their other dependencies.
  private readonly lang = toSignal(this.transloco.langChanges$, {
    initialValue: this.transloco.getActiveLang(),
  });

  protected readonly periodOptions = PERIOD_OPTIONS;
  protected readonly period = signal<ReportPeriod>('6m');
  protected readonly customFrom = signal('');
  protected readonly customTo = signal('');

  protected readonly buckets = computed<MonthBucket[]>(() =>
    resolveMonthBuckets(
      this.period(),
      this.customFrom(),
      this.customTo(),
      this.localeService.getLocale(),
    ),
  );

  protected readonly accountsResource = rxResource({ stream: () => this.accountRepository.list() });
  protected readonly categoryGroupsResource = rxResource({
    stream: () => this.categoryGroupRepository.list(),
  });
  protected readonly monthlyTotalsResource = rxResource({
    params: () => this.buckets(),
    stream: ({ params }) =>
      this.analyticsRepository.monthlyTotals(
        `${params[0].key}-01`,
        formatIsoDate(params.at(-1)!.end),
      ),
  });
  protected readonly categorySpendResource = rxResource({
    params: () => this.buckets(),
    stream: ({ params }) =>
      this.analyticsRepository.categorySpend(
        `${params[0].key}-01`,
        formatIsoDate(params.at(-1)!.end),
      ),
  });
  protected readonly balanceTrendResource = rxResource({
    params: () => this.buckets(),
    stream: ({ params }) =>
      this.analyticsRepository.balanceTrend(params.map((bucket) => bucket.key)),
  });
  private readonly dataResources = [
    this.accountsResource,
    this.categoryGroupsResource,
    this.monthlyTotalsResource,
    this.categorySpendResource,
    this.balanceTrendResource,
  ];
  protected readonly dataError = computed(() =>
    this.dataResources.some((resource) => resource.status() === 'error'),
  );

  protected readonly displayCurrency = this.displayCurrencyService.currency;

  private readonly foreignCurrencies = computed(() => {
    const display = this.displayCurrency();
    const accountCurrencies = (this.accountsResource.value() ?? []).map(
      (account) => account.currency,
    );
    const aggregateCurrencies = [
      ...(this.monthlyTotalsResource.value() ?? []),
      ...(this.categorySpendResource.value() ?? []),
      ...(this.balanceTrendResource.value() ?? []),
    ].map((row) => row.currency);
    return Array.from(new Set([...accountCurrencies, ...aggregateCurrencies])).filter(
      (currency) => currency !== display,
    );
  });

  private readonly rates = displayConverter(() => this.foreignCurrencies());
  private readonly converter = this.rates.converter;
  protected readonly hasFallbackRate = this.rates.hasFallbackRate;
  protected readonly ratesReady = computed(() => this.converter() !== null);
  protected readonly ratesFailed = this.rates.ratesFailed;

  protected readonly formatMoney = (value: number): string =>
    this.localeService.localizeNumber(String(value), 'currency', undefined, {
      currency: this.displayCurrency(),
      currencyDisplay: 'symbol',
    });

  private readonly monthlyTotals = computed(() => {
    const convert = this.converter();
    const display = this.displayCurrency();
    if (!convert) return [];

    const byMonth = new Map<string, { income: Money; expense: Money; net: Money }>();
    for (const row of this.monthlyTotalsResource.value() ?? []) {
      const current = byMonth.get(row.month) ?? {
        income: zero(display),
        expense: zero(display),
        net: zero(display),
      };
      byMonth.set(row.month, {
        income: add(current.income, convert(money(row.income, row.currency), display)),
        expense: add(current.expense, convert(money(row.expense, row.currency), display)),
        net: add(current.net, convert(money(row.net, row.currency), display)),
      });
    }
    return this.buckets().map(
      (bucket) =>
        byMonth.get(bucket.key) ?? {
          income: zero(display),
          expense: zero(display),
          net: zero(display),
        },
    );
  });

  protected readonly isEmpty = computed(() => {
    const aggregates = [
      this.monthlyTotalsResource,
      this.categorySpendResource,
      this.balanceTrendResource,
    ];
    return (
      !this.dataError() &&
      aggregates.every((resource) => !resource.isLoading()) &&
      aggregates.every((resource) => (resource.value() ?? []).length === 0)
    );
  });

  protected retryAll(): void {
    for (const resource of this.dataResources) resource.reload();
    this.rates.reload();
  }

  protected retryRates(): void {
    this.rates.reload();
  }

  protected readonly incomeExpenseChart = computed(() => {
    this.theme.current(); // re-resolve --positive/--negative on toggle
    this.lang();
    const convert = this.converter();
    if (!convert) return { labels: [], datasets: [] as ChartDataset[] };
    const buckets = this.buckets();
    const totals = this.monthlyTotals();
    const income = totals.map((entry) => toNumber(entry.income));
    const expense = totals.map((entry) => toNumber(entry.expense));

    const datasets: ChartDataset[] = [
      {
        label: this.transloco.translate('reports.series.income'),
        data: income,
        color: resolveCssColor('--positive'),
      },
      {
        label: this.transloco.translate('reports.series.expense'),
        data: expense,
        color: resolveCssColor('--negative'),
      },
    ];
    return { labels: buckets.map((b) => b.label), datasets };
  });

  protected readonly netFlowChart = computed(() => {
    this.theme.current(); // re-resolve --accent on toggle
    this.lang();
    const convert = this.converter();
    if (!convert) return { labels: [], datasets: [] as ChartDataset[] };
    const buckets = this.buckets();
    const net = this.monthlyTotals().map((entry) => toNumber(entry.net));

    const datasets: ChartDataset[] = [
      {
        label: this.transloco.translate('reports.series.netFlow'),
        data: net,
        color: resolveCssColor('--accent'),
      },
    ];
    return { labels: buckets.map((b) => b.label), datasets };
  });

  private readonly stableExpenseGroupIds = computed(() =>
    (this.categoryGroupsResource.value() ?? [])
      .filter((group) => group.kind === 'expense')
      .sort((a, b) => a.position - b.position)
      .map((group) => group.id),
  );

  protected readonly categoryTable = computed<CategoryTableRow[]>(() => {
    const convert = this.converter();
    if (!convert) return [];
    const display = this.displayCurrency();
    const totals = new Map<string, Money>();
    for (const row of this.categorySpendResource.value() ?? []) {
      const converted = convert(money(row.total, row.currency), display);
      totals.set(row.groupId, add(totals.get(row.groupId) ?? zero(display), converted));
    }
    const breakdown = Array.from(totals, ([groupId, total]) => ({ groupId, total }));
    const colorMap = categoryColorMap(this.stableExpenseGroupIds(), this.theme.current());
    const byId = new Map(
      (this.categoryGroupsResource.value() ?? []).map((group) => [group.id, group]),
    );
    const grandTotal = breakdown.reduce((total, entry) => total + toNumber(entry.total), 0);

    return breakdown
      .map((entry) => ({
        groupId: entry.groupId,
        name: byId.get(entry.groupId)?.name ?? entry.groupId,
        color: colorMap.get(entry.groupId) ?? resolveCssColor('--content-subtle'),
        total: entry.total,
        percent: grandTotal > 0 ? (toNumber(entry.total) / grandTotal) * 100 : 0,
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
        colors: rows.map((row) => row.color),
      },
    ];
    return { labels: rows.map((row) => row.name), datasets };
  });

  private readonly stableAccountIds = computed(() =>
    (this.accountsResource.value() ?? []).filter((a) => !a.archived).map((a) => a.id),
  );

  protected readonly balanceTrendChart = computed(() => {
    const convert = this.converter();
    if (!convert) return { labels: [], datasets: [] as ChartDataset[] };
    const buckets = this.buckets();
    const accounts = (this.accountsResource.value() ?? []).filter((a) => !a.archived);
    const points = new Map(
      (this.balanceTrendResource.value() ?? []).map((point) => [
        `${point.accountId}:${point.month}`,
        point,
      ]),
    );
    const colorMap = categoryColorMap(this.stableAccountIds(), this.theme.current());

    const datasets: ChartDataset[] = accounts.map((account: Account) => ({
      label: account.name,
      color: colorMap.get(account.id),
      data: buckets.map((bucket) => {
        const point = points.get(`${account.id}:${bucket.key}`);
        return toNumber(
          convert(
            money(point?.balance ?? '0', point?.currency ?? account.currency),
            this.displayCurrency(),
          ),
        );
      }),
    }));

    return { labels: buckets.map((b) => b.label), datasets };
  });

  protected onPeriodChange(value: string): void {
    this.period.set(value as ReportPeriod);
  }
}
