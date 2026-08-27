import { Component, computed, inject, signal } from '@angular/core';
import { rxResource, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { TranslocoLocaleService } from '@jsverse/transloco-locale';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { ConfirmService } from '../../core/confirm.service';
import { DisplayCurrencyService } from '../../core/display-currency.service';
import { MutationErrorService } from '../../core/mutation-error.service';
import { openOnNewParam } from '../../core/open-on-new-param';
import { AccountRepository } from '../../data/account.repository';
import { CategoryGroupRepository } from '../../data/category-group.repository';
import { CategoryRepository } from '../../data/category.repository';
import { InstitutionRepository } from '../../data/institution.repository';
import { RecurringRuleRepository } from '../../data/recurring-rule.repository';
import {
  SortOrder,
  TransactionFilters as RepoFilters,
  TransactionRepository,
  TransactionSort,
} from '../../data/transaction.repository';
import { identityConverter } from '../../domain/calc/aggregations';
import { effectiveAmount } from '../../domain/calc/conversion';
import { addDays, addMonthsClamped, formatIsoDate, monthKey, parseIsoDate } from '../../domain/calc/dates';
import { projectOccurrences } from '../../domain/calc/recurrence';
import { ProjectedTransaction, RecurringRule } from '../../domain/models/recurring';
import { Transaction, TransactionType } from '../../domain/models/transaction';
import { add, money, subtract, toNumber, zero } from '../../shared/money/money';
import { displayConverter } from '../../shared/money/display-converter';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { Badge } from '../../shared/ui/badge/badge';
import { Button } from '../../shared/ui/button/button';
import { Card } from '../../shared/ui/card/card';
import { Dropdown } from '../../shared/ui/dropdown/dropdown';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { Icon } from '../../shared/ui/icon/icon';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { buildMonthGrid } from './calendar-month';
import { RecurringRuleFormModal } from './recurring-rule-form-modal';
import { ALL_COLUMNS, TransactionColumn } from './transaction-columns';
import { downloadCsv, toCsv } from './transaction-csv';
import { EMPTY_FILTERS, matchesFilters, toQuery, TransactionFilters } from './transaction-filters';
import { TransactionBulkBar } from './transaction-bulk-bar';
import { TransactionCalendar } from './transaction-calendar';
import { TransactionFilterBar } from './transaction-filter-bar';
import { TransactionFormModal } from './transaction-form-modal';
import { TransactionTable } from './transaction-table';
import { rowSign, rowToneClass } from './transaction-tone';
import { TransactionViewPrefsService } from './transaction-view-prefs.service';

const PROJECTION_HORIZON_DAYS = 60;
const TRANSACTION_TYPES: readonly TransactionType[] = ['income', 'expense', 'transfer'];
const SEARCH_DEBOUNCE_MS = 250;

/**
 * The literal keys passed to `confirmService.confirm(...)` below are real
 * string literals, invisible to transloco-keys-manager's extractor -
 * declare them so `task i18n:validate` sees them:
 * t(transactions.delete.title, transactions.delete.message, transactions.recurring.delete.title, transactions.recurring.delete.message, transactions.bulk.deleteConfirm.title, transactions.bulk.deleteConfirm.message)
 * The CSV header and column-menu keys are built by concatenation:
 * t(transactions.columns.date, transactions.columns.description, transactions.columns.category, transactions.columns.account, transactions.columns.amount, transactions.columns.title, transactions.export.filename, transactions.type.income, transactions.type.expense, transactions.type.transfer)
 */
@Component({
  selector: 'app-transactions',
  imports: [
    TranslocoDirective,
    RouterLink,
    MoneyPipe,
    Badge,
    Button,
    Card,
    Dropdown,
    EmptyState,
    Icon,
    PageHeader,
    TransactionFilterBar,
    TransactionTable,
    TransactionBulkBar,
    TransactionCalendar,
    TransactionFormModal,
    RecurringRuleFormModal,
  ],
  templateUrl: './transactions.html',
  styleUrl: './transactions.scss',
})
export class Transactions {
  private readonly mutationErrors = inject(MutationErrorService);
  private readonly transactionRepository = inject(TransactionRepository);
  private readonly accountRepository = inject(AccountRepository);
  private readonly categoryGroupRepository = inject(CategoryGroupRepository);
  private readonly categoryRepository = inject(CategoryRepository);
  private readonly recurringRuleRepository = inject(RecurringRuleRepository);
  private readonly institutionRepository = inject(InstitutionRepository);
  private readonly confirmService = inject(ConfirmService);
  private readonly transloco = inject(TranslocoService);
  private readonly locale = inject(TranslocoLocaleService);
  private readonly displayCurrencyService = inject(DisplayCurrencyService);
  protected readonly prefs = inject(TransactionViewPrefsService);

  protected readonly displayCurrency = this.displayCurrencyService.currency;
  protected readonly allColumns = ALL_COLUMNS;

  protected readonly accountsResource = rxResource({ stream: () => this.accountRepository.list() });
  protected readonly categoriesResource = rxResource({ stream: () => this.categoryRepository.list() });
  protected readonly categoryGroupsResource = rxResource({
    stream: () => this.categoryGroupRepository.list(),
  });
  protected readonly recurringRulesResource = rxResource({
    stream: () => this.recurringRuleRepository.list(),
  });
  protected readonly institutionsResource = rxResource({
    stream: () => this.institutionRepository.list(),
  });

  protected readonly tab = signal<'transactions' | 'recurring'>('transactions');
  protected readonly mode = signal<'list' | 'calendar'>('list');
  protected readonly filters = signal<TransactionFilters>(EMPTY_FILTERS);
  protected readonly page = signal(1);
  protected readonly sort = signal<TransactionSort>('date');
  protected readonly order = signal<SortOrder>('desc');
  protected readonly selectedIds = signal<ReadonlySet<string>>(new Set());
  protected readonly calendarMonth = signal(monthKey(new Date().toISOString()));
  protected readonly selectedDay = signal<string | null>(null);

  protected readonly txFormOpen = signal(false);
  protected readonly editingTx = signal<Transaction | undefined>(undefined);
  protected readonly ruleFormOpen = signal(false);
  protected readonly editingRule = signal<RecurringRule | undefined>(undefined);

  // Debounce lives here, not in the filter bar: the bar emits on every
  // keystroke; only the settled value reaches the query.
  private readonly searchInput = signal('');
  private readonly debouncedSearch = toSignal(
    toObservable(this.searchInput).pipe(debounceTime(SEARCH_DEBOUNCE_MS), distinctUntilChanged()),
    { initialValue: '' },
  );

  private readonly query = computed<RepoFilters>(() => ({
    ...toQuery(this.filters()),
    search: this.debouncedSearch() || undefined,
    types: this.filters().type ? [this.filters().type as TransactionType] : TRANSACTION_TYPES,
    sort: this.sort(),
    order: this.order(),
    limit: this.prefs.pageSize(),
    offset: (this.page() - 1) * this.prefs.pageSize(),
  }));

  protected readonly pageResource = rxResource({
    params: () => this.query(),
    stream: ({ params }) => this.transactionRepository.listPage(params),
  });

  protected readonly rows = computed(() => this.pageResource.value()?.items ?? []);
  protected readonly total = computed(() => this.pageResource.value()?.total ?? 0);
  protected readonly pageCount = computed(() =>
    Math.max(1, Math.ceil(this.total() / this.prefs.pageSize())),
  );
  protected readonly isEmpty = computed(
    () => this.pageResource.hasValue() && this.rows().length === 0,
  );

  // Unpaginated set of already-posted recurring occurrences from today on,
  // so a projection for an occurrence the backend already posted isn't
  // drawn as a ghost row.
  protected readonly postedOccurrencesResource = rxResource({
    stream: () => this.transactionRepository.list({ dateFrom: formatIsoDate(new Date()) }),
  });

  protected readonly accountsById = computed(
    () => new Map((this.accountsResource.value() ?? []).map((a) => [a.id, a])),
  );
  protected readonly categoriesById = computed(
    () => new Map((this.categoriesResource.value() ?? []).map((c) => [c.id, c])),
  );
  protected readonly groupsById = computed(
    () => new Map((this.categoryGroupsResource.value() ?? []).map((g) => [g.id, g])),
  );
  protected readonly institutionsById = computed(
    () => new Map((this.institutionsResource.value() ?? []).map((i) => [i.id, i])),
  );

  private readonly postedOccurrences = computed<Set<string>>(
    () =>
      new Set(
        (this.postedOccurrencesResource.value() ?? [])
          .filter((tx) => tx.recurringRuleId)
          .map((tx) => `${tx.recurringRuleId}|${tx.date}`),
      ),
  );

  protected readonly projectedRows = computed<ProjectedTransaction[]>(() => {
    const rules = this.recurringRulesResource.value() ?? [];
    const filters = this.filters();
    const posted = this.postedOccurrences();
    const from = formatIsoDate(new Date());
    const to = formatIsoDate(addDays(new Date(), PROJECTION_HORIZON_DAYS));

    return rules
      .flatMap((rule) => projectOccurrences(rule, from, to))
      .filter((occurrence) => !posted.has(`${occurrence.recurringRuleId}|${occurrence.date}`))
      .filter((occurrence) =>
        matchesFilters(occurrence, filters, this.accountsById(), this.categoriesById()),
      )
      .sort((a, b) => a.date.localeCompare(b.date));
  });

  // --- Selection -----------------------------------------------------------

  protected readonly selectedRows = computed(() =>
    this.rows().filter((tx) => this.selectedIds().has(tx.id)),
  );

  private readonly selectionConverter = displayConverter(() => [
    ...new Set(this.selectedRows().map((tx) => tx.currency)),
  ]);

  protected readonly selectedTotal = computed<string | null>(() => {
    const convert = this.selectionConverter.converter();
    if (!convert) return null;
    const target = this.displayCurrency();
    const total = this.selectedRows().reduce((acc, tx) => {
      if (tx.type === 'transfer') return acc;
      const value = convert(money(tx.conversion?.amount ?? tx.amount, tx.currency), target);
      return tx.type === 'expense' ? subtract(acc, value) : add(acc, value);
    }, zero(target));
    return total.amount;
  });

  // --- Calendar ----------------------------------------------------------

  private readonly monthBounds = computed(() => {
    const start = parseIsoDate(`${this.calendarMonth()}-01`);
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
    return {
      start: formatIsoDate(start),
      end: formatIsoDate(end),
      openingAsOf: formatIsoDate(addDays(start, -1)),
    };
  });

  protected readonly monthLabel = computed(() =>
    this.locale.localizeDate(`${this.calendarMonth()}-01`, undefined, {
      year: 'numeric',
      month: 'long',
    }),
  );

  protected readonly monthTxResource = rxResource({
    params: () => this.monthBounds(),
    // ponytail: unbounded - a calendar month has no limit. Add one only if
    // a month ever holds more than a few thousand rows.
    stream: ({ params }) =>
      this.transactionRepository.list({ dateFrom: params.start, dateTo: params.end }),
  });

  protected readonly openingBalancesResource = rxResource({
    params: () => this.monthBounds().openingAsOf,
    stream: ({ params }) => this.accountRepository.balances(params),
  });

  private readonly openingConverter = displayConverter(() => [
    ...new Set((this.openingBalancesResource.value() ?? []).map((b) => b.currency)),
  ]);

  // A cross-currency transaction's running-balance delta is taken in its
  // *effective* currency (the account it posted to), not tx.currency, so the
  // converter has to cover that pair too - otherwise converterFromRates
  // passes the amount through unconverted and add()/subtract() throw on the
  // mismatch. See reports.ts for the same effectiveAmount().currency set.
  private readonly monthConverter = displayConverter(() => [
    ...new Set(
      (this.monthTxResource.value() ?? []).flatMap((tx) => [
        tx.currency,
        effectiveAmount(tx).currency,
      ]),
    ),
  ]);

  protected readonly calendarDays = computed(() => {
    const convert = this.monthConverter.converter();
    const openingConvert = this.openingConverter.converter();
    const target = this.displayCurrency();
    const balances = this.openingBalancesResource.value();

    // Running balances need both converters. Until every rate has arrived,
    // render the grid without balances rather than feeding an unconverted
    // passthrough into add()/subtract() (see display-converter.ts).
    const opening =
      balances && openingConvert && convert
        ? balances.reduce(
            (acc, b) => add(acc, openingConvert(money(b.balance, b.currency), target)),
            zero(target),
          )
        : null;

    const weekStart = this.weekStart();
    const grid = buildMonthGrid(
      this.calendarMonth(),
      this.monthTxResource.value() ?? [],
      this.projectedRows().filter((p) => p.date.slice(0, 7) === this.calendarMonth()),
      opening,
      // Only reached when opening is null, so convert is never actually
      // invoked here; identityConverter throws loudly if that ever changes.
      convert ?? identityConverter,
      weekStart,
      formatIsoDate(new Date()),
    );

    // Filters narrow the activity dots and the day drill-down, but never the
    // running balance - that stays anchored to the true portfolio.
    const filters = { ...this.filters(), search: this.debouncedSearch() };
    const accountsById = this.accountsById();
    const categoriesById = this.categoriesById();
    return grid.map((day) => {
      const shown = day.transactions.filter((tx) =>
        matchesFilters(tx, filters, accountsById, categoriesById),
      );
      if (shown.length === day.transactions.length) return day;
      return {
        ...day,
        transactions: shown,
        hasIncome: shown.some((tx) => tx.type === 'income' || tx.type === 'interest'),
        hasExpense: shown.some((tx) => tx.type === 'expense'),
        hasTransfer: shown.some((tx) => tx.type === 'transfer'),
      };
    });
  });

  protected readonly weekStart = computed(() => {
    try {
      const info = (new Intl.Locale(this.transloco.getActiveLang()) as unknown as {
        weekInfo?: { firstDay?: number };
        getWeekInfo?: () => { firstDay?: number };
      });
      const first = info.getWeekInfo?.().firstDay ?? info.weekInfo?.firstDay;
      return first === 7 ? 0 : (first ?? 1);
    } catch {
      return 1;
    }
  });

  constructor() {
    openOnNewParam(() => this.openCreateTx());
  }

  // --- Filter / sort / page mutators ------------------------------------
  // Every mutator resets the page and clears the selection in the same
  // synchronous tick as the change that invalidates them, so `query`
  // recomputes exactly once and only one request fires. Do NOT move these
  // resets into an effect - that reintroduces a double request.

  protected onFiltersChange(next: TransactionFilters): void {
    this.filters.set(next);
    this.page.set(1);
    this.selectedIds.set(new Set());
  }

  protected onSearchChange(value: string): void {
    this.searchInput.set(value);
    this.page.set(1);
  }

  protected clearFilters(): void {
    this.filters.set(EMPTY_FILTERS);
    this.searchInput.set('');
    this.page.set(1);
    this.selectedIds.set(new Set());
  }

  protected setSort(column: TransactionSort): void {
    this.order.update(() => (this.sort() === column && this.order() === 'desc' ? 'asc' : 'desc'));
    this.sort.set(column);
    this.page.set(1);
  }

  protected setPage(next: number): void {
    this.page.set(Math.min(Math.max(1, next), this.pageCount()));
    this.selectedIds.set(new Set());
  }

  protected setPageSize(size: number): void {
    this.prefs.setPageSize(size);
    this.page.set(1);
  }

  protected toggleRow(id: string): void {
    this.selectedIds.update((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  protected toggleAll(checked: boolean): void {
    this.selectedIds.set(checked ? new Set(this.rows().map((tx) => tx.id)) : new Set());
  }

  protected clearSelection(): void {
    this.selectedIds.set(new Set());
  }

  protected selectDay(date: string): void {
    this.selectedDay.set(date);
  }

  protected setMode(mode: 'list' | 'calendar'): void {
    this.mode.set(mode);
  }

  protected stepMonth(delta: number): void {
    this.calendarMonth.set(
      monthKey(formatIsoDate(addMonthsClamped(parseIsoDate(`${this.calendarMonth()}-01`), delta))),
    );
    this.selectedDay.set(null);
  }

  // --- CSV ------------------------------------------------------------

  protected exportCsv(): void {
    const columns = this.allColumns.filter((c) => this.prefs.isVisible(c));
    const headers = columns.map((c) => this.transloco.translate('transactions.columns.' + c));
    const body = this.rows().map((tx) => columns.map((c) => this.csvCell(tx, c)));
    const name =
      this.transloco.translate('transactions.export.filename') +
      '-' +
      formatIsoDate(new Date()) +
      '.csv';
    downloadCsv(name, toCsv(headers, body));
  }

  private csvCell(tx: Transaction, column: TransactionColumn): string {
    switch (column) {
      case 'date':
        return tx.date;
      case 'description':
        return tx.description;
      case 'category': {
        if (tx.type === 'transfer' || !tx.categoryId) return '';
        return this.categoriesById().get(tx.categoryId)?.name ?? '';
      }
      case 'account':
        return this.accountsById().get(tx.accountId)?.name ?? '';
      case 'amount':
        // Raw decimal string - never a float, never localised.
        return `${rowSign(tx)}${tx.amount}`;
    }
  }

  // --- Mutations ----------------------------------------------------

  protected openCreateTx(): void {
    this.editingTx.set(undefined);
    this.txFormOpen.set(true);
  }

  protected openEditTx(tx: Transaction): void {
    this.editingTx.set(tx);
    this.txFormOpen.set(true);
  }

  protected onTxSaved(): void {
    this.pageResource.reload();
    this.monthTxResource.reload();
    this.openingBalancesResource.reload();
    this.postedOccurrencesResource.reload();
    this.recurringRulesResource.reload();
  }

  protected async deleteTx(tx: Transaction): Promise<void> {
    const confirmed = await this.confirmService.confirm(
      'transactions.delete.title',
      'transactions.delete.message',
      'danger',
    );
    if (!confirmed) return;
    this.transactionRepository.delete(tx.id).subscribe({
      next: () => {
        this.pageResource.reload();
        this.monthTxResource.reload();
        this.postedOccurrencesResource.reload();
      },
      error: () => this.mutationErrors.show(),
    });
  }

  protected async bulkDelete(): Promise<void> {
    const ids = [...this.selectedIds()];
    if (ids.length === 0) return;
    const confirmed = await this.confirmService.confirm(
      'transactions.bulk.deleteConfirm.title',
      'transactions.bulk.deleteConfirm.message',
      'danger',
      { count: ids.length },
    );
    if (!confirmed) return;
    this.transactionRepository.bulkDelete(ids).subscribe({
      next: () => {
        this.selectedIds.set(new Set());
        this.pageResource.reload();
        this.monthTxResource.reload();
        this.postedOccurrencesResource.reload();
      },
      error: () => this.mutationErrors.show(),
    });
  }

  protected bulkCategorize(categoryId: string): void {
    const ids = [...this.selectedIds()];
    if (ids.length === 0) return;
    this.transactionRepository.bulkCategorize(ids, categoryId).subscribe({
      next: () => {
        this.selectedIds.set(new Set());
        this.pageResource.reload();
        this.monthTxResource.reload();
      },
      error: () => this.mutationErrors.show(),
    });
  }

  protected openCreateRule(): void {
    this.editingRule.set(undefined);
    this.ruleFormOpen.set(true);
  }

  protected openEditRule(rule: RecurringRule): void {
    this.editingRule.set(rule);
    this.ruleFormOpen.set(true);
  }

  protected onRuleSaved(): void {
    this.recurringRulesResource.reload();
  }

  protected async deleteRule(rule: RecurringRule): Promise<void> {
    const confirmed = await this.confirmService.confirm(
      'transactions.recurring.delete.title',
      'transactions.recurring.delete.message',
      'danger',
    );
    if (!confirmed) return;
    this.recurringRuleRepository.delete(rule.id).subscribe({
      next: () => this.recurringRulesResource.reload(),
      error: () => this.mutationErrors.show(),
    });
  }

  protected nextOccurrence(rule: RecurringRule): string | undefined {
    const from = formatIsoDate(new Date());
    const to = formatIsoDate(addDays(new Date(), 366));
    return projectOccurrences(rule, from, to)[0]?.date;
  }

  protected ruleAmountPrefix(rule: RecurringRule): string {
    return rule.template.type === 'income' ? '+' : '−';
  }

  protected readonly rowToneClass = rowToneClass;
  protected readonly rowSign = rowSign;
  protected readonly toNumber = toNumber;
}
