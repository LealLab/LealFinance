import { Component, computed, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { TranslocoDirective } from '@jsverse/transloco';
import { forkJoin, map, of } from 'rxjs';
import { DisplayCurrencyService } from '../../core/display-currency.service';
import { AccountRepository } from '../../data/account.repository';
import { CardInvoiceRepository } from '../../data/card-invoice.repository';
import { LoanRepository } from '../../data/loan.repository';
import { RecurringRuleRepository } from '../../data/recurring-rule.repository';
import { TransactionRepository } from '../../data/transaction.repository';
import { effectiveAmount } from '../../domain/calc/conversion';
import { AgendaInvoice, AgendaResult, agendaRange, buildAgenda } from '../../domain/calc/agenda';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { displayConverter } from '../../shared/money/display-converter';
import { ExchangeRateWarning } from '../../shared/exchange-rate-warning/exchange-rate-warning';
import { Badge } from '../../shared/ui/badge/badge';
import { Card } from '../../shared/ui/card/card';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { LoadError } from '../../shared/ui/load-error/load-error';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { StatTile } from '../../shared/ui/stat-tile/stat-tile';
import { todayIso } from '../../domain/calc/dates';

/**
 * Dynamic translation keys used by the agenda table.
 * t(agenda.source.recurrence, agenda.source.invoice, agenda.source.installment, agenda.status.realized, agenda.status.projected, agenda.direction.inflow, agenda.direction.outflow)
 */
@Component({
  selector: 'app-agenda',
  imports: [
    TranslocoDirective,
    MoneyPipe,
    Badge,
    Card,
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
  private readonly range = agendaRange(todayIso());

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
                .list(accountId, { back: 0, ahead: 2 })
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
