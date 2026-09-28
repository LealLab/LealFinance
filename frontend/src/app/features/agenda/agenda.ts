import { Component, computed, inject, signal } from '@angular/core';
import { rxResource, toSignal } from '@angular/core/rxjs-interop';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { TranslocoLocaleService } from '@jsverse/transloco-locale';
import { forkJoin, map, of } from 'rxjs';
import { DisplayCurrencyService } from '../../core/display-currency.service';
import { AccountRepository } from '../../data/account.repository';
import { CardInvoiceRepository } from '../../data/card-invoice.repository';
import { LoanRepository } from '../../data/loan.repository';
import { RecurringRuleRepository } from '../../data/recurring-rule.repository';
import { TransactionRepository } from '../../data/transaction.repository';
import { effectiveAmount } from '../../domain/calc/conversion';
import {
  AgendaEntry,
  AgendaInvoice,
  AgendaResult,
  agendaRange,
  buildAgenda,
} from '../../domain/calc/agenda';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { displayConverter } from '../../shared/money/display-converter';
import { ExchangeRateWarning } from '../../shared/exchange-rate-warning/exchange-rate-warning';
import { Badge } from '../../shared/ui/badge/badge';
import { Card } from '../../shared/ui/card/card';
import { Dropdown } from '../../shared/ui/dropdown/dropdown';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { LoadError } from '../../shared/ui/load-error/load-error';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { StatTile } from '../../shared/ui/stat-tile/stat-tile';
import { todayIso } from '../../domain/calc/dates';

type AgendaStatusFilter = 'all' | 'projected' | 'realized';

/**
 * Dynamic translation keys used by the agenda table, status filter and summary help.
 * t(agenda.source.recurrence, agenda.source.invoice, agenda.source.installment, agenda.status.realized, agenda.status.projected, agenda.direction.inflow, agenda.direction.outflow)
 * t(agenda.summary.projectedCashImpact, agenda.summary.realizedCashImpact, agenda.summary.projectedOutflow, agenda.summary.realizedOutflow)
 * t(agenda.filter.all, agenda.help.projectedCashImpact, agenda.help.realizedCashImpact, agenda.help.projectedOutflow, agenda.help.realizedOutflow)
 */
@Component({
  selector: 'app-agenda',
  imports: [
    TranslocoDirective,
    MoneyPipe,
    Badge,
    Card,
    Dropdown,
    EmptyState,
    ExchangeRateWarning,
    LoadError,
    PageHeader,
    Skeleton,
    StatTile,
  ],
  templateUrl: './agenda.html',
  styleUrl: './agenda.scss',
})
export class Agenda {
  private readonly accountRepository = inject(AccountRepository);
  private readonly cardInvoiceRepository = inject(CardInvoiceRepository);
  private readonly loanRepository = inject(LoanRepository);
  private readonly recurringRuleRepository = inject(RecurringRuleRepository);
  private readonly transactionRepository = inject(TransactionRepository);
  private readonly displayCurrencyService = inject(DisplayCurrencyService);
  private readonly localeService = inject(TranslocoLocaleService);
  private readonly transloco = inject(TranslocoService);
  // Read so dayLabel-based computeds re-run on a language switch.
  private readonly lang = toSignal(this.transloco.langChanges$, {
    initialValue: this.transloco.getActiveLang(),
  });
  protected readonly today = todayIso();
  private readonly range = agendaRange(this.today);
  protected readonly statusOptions = ['all', 'projected', 'realized'] as const;
  protected readonly summaryTiles = [
    { key: 'projectedCashImpact', summary: 'projected', field: 'cashImpact', tone: 'negative' },
    { key: 'realizedCashImpact', summary: 'realized', field: 'cashImpact', tone: 'default' },
    { key: 'projectedOutflow', summary: 'projected', field: 'outflow', tone: 'negative' },
    { key: 'realizedOutflow', summary: 'realized', field: 'outflow', tone: 'default' },
  ] as const;
  protected readonly status = signal<AgendaStatusFilter>('all');

  protected readonly displayCurrency = this.displayCurrencyService.currency;
  protected readonly accountsResource = rxResource({ stream: () => this.accountRepository.list() });
  protected readonly recurringRulesResource = rxResource({
    stream: () => this.recurringRuleRepository.list(),
  });
  protected readonly loansResource = rxResource({ stream: () => this.loanRepository.list() });
  protected readonly transactionsResource = rxResource({
    stream: () => this.transactionRepository.list(),
  });

  private readonly cardAccountIds = computed(() =>
    (this.accountsResource.value() ?? [])
      .filter((account) => account.type === 'credit_card' && !account.archived)
      .map((account) => account.id),
  );

  protected readonly invoicesResource = rxResource({
    params: () => this.cardAccountIds(),
    stream: ({ params }) =>
      params.length === 0
        ? of([] as AgendaInvoice[])
        : forkJoin(
            params.map((accountId) =>
              this.cardInvoiceRepository
                .list(accountId, { back: 1, ahead: 2 })
                .pipe(map((invoices) => invoices.map((invoice) => ({ accountId, invoice })))),
            ),
          ).pipe(map((groups) => groups.flat())),
  });

  private readonly dataResources = [
    this.accountsResource,
    this.recurringRulesResource,
    this.loansResource,
    this.transactionsResource,
    this.invoicesResource,
  ];
  protected readonly dataError = computed(() =>
    this.dataResources.some((resource) => resource.status() === 'error'),
  );

  private readonly foreignCurrencies = computed(() => {
    const display = this.displayCurrency();
    const accounts = this.accountsResource.value() ?? [];
    const rules = this.recurringRulesResource.value() ?? [];
    const invoices = this.invoicesResource.value() ?? [];
    const loans = this.loansResource.value() ?? [];
    const transactions = this.transactionsResource.value() ?? [];
    const currencies = [
      ...accounts.map((account) => account.currency),
      ...rules.flatMap((rule) => [
        rule.template.currency,
        rule.template.conversion?.currency ?? rule.template.currency,
      ]),
      ...invoices.map(({ invoice }) => invoice.currency),
      ...loans.map((loan) => loan.currency),
      ...transactions.flatMap((transaction) => [
        effectiveAmount(transaction).currency,
        transaction.currency,
      ]),
    ];
    return Array.from(new Set(currencies)).filter((currency) => currency !== display);
  });

  private readonly rates = displayConverter(() => this.foreignCurrencies());
  protected readonly hasFallbackRate = this.rates.hasFallbackRate;
  private readonly converter = this.rates.converter;
  protected readonly ratesReady = computed(() => this.converter() !== null);
  protected readonly ratesFailed = this.rates.ratesFailed;

  protected readonly agenda = computed<AgendaResult | null>(() => {
    const convert = this.converter();
    if (!convert) return null;
    return buildAgenda(
      {
        rangeStart: this.range.rangeStart,
        rangeEnd: this.range.rangeEnd,
        accounts: this.accountsResource.value() ?? [],
        recurringRules: this.recurringRulesResource.value() ?? [],
        invoices: this.invoicesResource.value() ?? [],
        loans: this.loansResource.value() ?? [],
        transactions: this.transactionsResource.value() ?? [],
      },
      this.displayCurrency(),
      convert,
    );
  });

  protected readonly counts = computed(() => {
    const entries = this.agenda()?.entries ?? [];
    const realized = entries.filter((entry) => entry.realized).length;
    return { all: entries.length, projected: entries.length - realized, realized };
  });

  protected readonly entries = computed(() => {
    const status = this.status();
    const entries = this.agenda()?.entries ?? [];
    return status === 'all'
      ? entries
      : entries.filter((entry) => entry.realized === (status === 'realized'));
  });

  /** Entries grouped by date for the mobile list; buildAgenda already sorts by date. */
  protected readonly groups = computed(() => {
    const groups: { date: string; label: string; entries: AgendaEntry[] }[] = [];
    for (const entry of this.entries()) {
      const last = groups.at(-1);
      if (last?.date === entry.date) last.entries.push(entry);
      else groups.push({ date: entry.date, label: this.dayLabel(entry.date), entries: [entry] });
    }
    return groups;
  });

  private readonly dayFormat = computed(() => {
    this.lang();
    return new Intl.DateTimeFormat(this.localeService.getLocale(), {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
  });

  protected dayLabel(iso: string): string {
    const label = this.dayFormat().format(new Date(`${iso}T00:00:00Z`));
    return label.charAt(0).toLocaleUpperCase() + label.slice(1);
  }

  protected readonly isEmpty = computed(
    () =>
      !this.dataResources.some((resource) => resource.isLoading()) &&
      !this.dataError() &&
      this.ratesReady() &&
      (this.agenda()?.entries.length ?? 0) === 0,
  );

  protected retryAll(): void {
    for (const resource of this.dataResources) resource.reload();
    this.rates.reload();
  }

  protected retryRates(): void {
    this.rates.reload();
  }
}
