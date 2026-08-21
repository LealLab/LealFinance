import { Component, computed, effect, ElementRef, inject, signal, viewChild } from '@angular/core';
import { rxResource, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { forkJoin, of } from 'rxjs';
import { ConfirmService } from '../../core/confirm.service';
import { DisplayCurrencyService } from '../../core/display-currency.service';
import { MutationErrorService } from '../../core/mutation-error.service';
import { AccountRepository } from '../../data/account.repository';
import { CategoryRepository } from '../../data/category.repository';
import { ExchangeRateRepository } from '../../data/exchange-rate.repository';
import { InstitutionRepository } from '../../data/institution.repository';
import { ManualRateRepository } from '../../data/manual-rate.repository';
import { TransactionRepository } from '../../data/transaction.repository';
import { totalConversionFees, transactionsNeedingAttention } from '../../domain/calc/exchange';
import { displayConverter } from '../../shared/money/display-converter';
import { ExchangeRate } from '../../domain/models/exchange-rate';
import { ManualRate } from '../../domain/models/manual-rate';
import { Transaction } from '../../domain/models/transaction';
import { zero } from '../../shared/money/money';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { Button } from '../../shared/ui/button/button';
import { Card } from '../../shared/ui/card/card';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { Icon } from '../../shared/ui/icon/icon';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { StatTile } from '../../shared/ui/stat-tile/stat-tile';
import { TransactionFormModal } from '../transactions/transaction-form-modal';
import { ManualRateFormModal } from './manual-rate-form-modal';

/**
 * The literal keys passed to `confirmService.confirm(...)` below are real
 * string literals, but the call itself isn't to the `t` marker function,
 * so transloco-keys-manager's extractor never sees them - same "dynamic
 * markings" situation as budgets.ts/transactions.ts:
 * t(exchange.manualRates.delete.title, exchange.manualRates.delete.message)
 */
@Component({
  selector: 'app-exchange',
  imports: [
    TranslocoDirective,
    MoneyPipe,
    Button,
    Card,
    EmptyState,
    Icon,
    PageHeader,
    Skeleton,
    StatTile,
    TransactionFormModal,
    ManualRateFormModal
  ],
  templateUrl: './exchange.html',
  styleUrl: './exchange.scss'
})
export class Exchange {
  private readonly mutationErrors = inject(MutationErrorService);
  private readonly transactionRepository = inject(TransactionRepository);
  private readonly accountRepository = inject(AccountRepository);
  private readonly categoryRepository = inject(CategoryRepository);
  private readonly institutionRepository = inject(InstitutionRepository);
  private readonly manualRateRepository = inject(ManualRateRepository);
  private readonly exchangeRateRepository = inject(ExchangeRateRepository);
  private readonly confirmService = inject(ConfirmService);
  private readonly route = inject(ActivatedRoute);
  protected readonly displayCurrencyService = inject(DisplayCurrencyService);

  protected readonly transactionsResource = rxResource({ stream: () => this.transactionRepository.list() });
  protected readonly accountsResource = rxResource({ stream: () => this.accountRepository.list() });
  protected readonly categoriesResource = rxResource({ stream: () => this.categoryRepository.list() });
  protected readonly institutionsResource = rxResource({ stream: () => this.institutionRepository.list() });
  protected readonly manualRatesResource = rxResource({ stream: () => this.manualRateRepository.list() });

  protected readonly displayCurrency = this.displayCurrencyService.currency;

  private readonly accountsById = computed(
    () => new Map((this.accountsResource.value() ?? []).map((account) => [account.id, account]))
  );

  protected readonly needsAttentionRows = computed(() => {
    const accountsById = this.accountsById();
    return transactionsNeedingAttention(this.transactionsResource.value() ?? [])
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((tx) => ({ tx, account: accountsById.get(tx.accountId) }));
  });

  /** Currencies any non-archived account holds, other than the display currency. */
  private readonly foreignAccountCurrencies = computed(() => {
    const display = this.displayCurrency();
    const accounts = this.accountsResource.value() ?? [];
    return Array.from(
      new Set(accounts.filter((account) => !account.archived && account.currency !== display).map((account) => account.currency))
    );
  });

  protected readonly accountRatesResource = rxResource({
    params: () => ({ currencies: this.foreignAccountCurrencies(), display: this.displayCurrency() }),
    stream: ({ params }) =>
      params.currencies.length === 0
        ? of([] as ExchangeRate[])
        : forkJoin(
            params.currencies.map((currency) => this.exchangeRateRepository.getRate(currency, params.display))
          )
  });

  /**
   * Account currencies currently resolving to a 1:1 fallback against the
   * display currency - a live coverage gap, distinct from
   * `needsAttentionRows` (which only covers recorded transaction
   * conversions). An account balance can be shown as a 1:1 approximation
   * on the dashboard's net worth without any transaction ever being
   * involved, so that case needs its own detection here.
   */
  protected readonly currenciesNeedingRate = computed(() =>
    (this.accountRatesResource.value() ?? []).filter((rate) => rate.isFallback).map((rate) => rate.baseCode)
  );
  protected readonly isCurrenciesNeedingRateEmpty = computed(
    () => !this.accountRatesResource.isLoading() && this.currenciesNeedingRate().length === 0
  );

  /**
   * Currencies any recorded fee is denominated in, other than the display
   * currency - drives the rate fetch below, mirroring
   * features/dashboard/dashboard.ts's `foreignCurrencies`/`converter` pair.
   */
  private readonly foreignFeeCurrencies = computed(() => {
    const display = this.displayCurrency();
    const currencies = (this.transactionsResource.value() ?? [])
      .filter((tx) => tx.conversion?.fee)
      .map((tx) => tx.currency)
      .filter((currency) => currency !== display);
    return Array.from(new Set(currencies));
  });

  private readonly feeRates = displayConverter(() => this.foreignFeeCurrencies());
  private readonly feeConverter = this.feeRates.converter;
  protected readonly feeRatesReady = computed(() => this.feeConverter() !== null);

  protected readonly totalFees = computed(() => {
    const convert = this.feeConverter();
    if (!convert) return zero(this.displayCurrency());
    return totalConversionFees(this.transactionsResource.value() ?? [], this.displayCurrency(), convert);
  });

  protected readonly manualRates = computed(() =>
    (this.manualRatesResource.value() ?? []).slice().sort((a, b) => b.asOf.localeCompare(a.asOf))
  );

  protected readonly isNeedsAttentionEmpty = computed(
    () => !this.transactionsResource.isLoading() && this.needsAttentionRows().length === 0
  );
  protected readonly isManualRatesEmpty = computed(
    () => !this.manualRatesResource.isLoading() && this.manualRates().length === 0
  );

  protected readonly txFormOpen = signal(false);
  protected readonly editingTx = signal<Transaction | undefined>(undefined);
  protected readonly rateFormOpen = signal(false);
  protected readonly editingRate = signal<ManualRate | undefined>(undefined);
  protected readonly prefillRatePair = signal<{ baseCode: string; quoteCode: string } | undefined>(undefined);

  // Deep-link support for the dashboard's fallback-rate warning and the
  // command palette - mirrors features/settings/settings.ts's
  // fragment-scroll pattern.
  private readonly fragment = toSignal(this.route.fragment, { initialValue: this.route.snapshot.fragment });
  private readonly manualRatesSection = viewChild<ElementRef<HTMLElement>>('manualRatesSection');

  constructor() {
    effect(() => {
      if (this.fragment() !== 'manual-rates') return;
      this.manualRatesSection()?.nativeElement.scrollIntoView({ block: 'start' });
    });
  }

  protected openFix(tx: Transaction): void {
    this.editingTx.set(tx);
    this.txFormOpen.set(true);
  }

  protected onTxSaved(): void {
    this.transactionsResource.reload();
  }

  protected openCreateRate(): void {
    this.editingRate.set(undefined);
    this.prefillRatePair.set(undefined);
    this.rateFormOpen.set(true);
  }

  protected openCreateRateFor(baseCode: string): void {
    this.editingRate.set(undefined);
    this.prefillRatePair.set({ baseCode, quoteCode: this.displayCurrency() });
    this.rateFormOpen.set(true);
  }

  protected openEditRate(rate: ManualRate): void {
    this.editingRate.set(rate);
    this.prefillRatePair.set(undefined);
    this.rateFormOpen.set(true);
  }

  protected onRateSaved(): void {
    this.manualRatesResource.reload();
    this.accountRatesResource.reload();
    this.feeRates.reload();
  }

  protected async deleteRate(rate: ManualRate): Promise<void> {
    const confirmed = await this.confirmService.confirm(
      'exchange.manualRates.delete.title',
      'exchange.manualRates.delete.message',
      'danger'
    );
    if (!confirmed) return;
    this.manualRateRepository.delete(rate.id).subscribe({
      next: () => this.manualRatesResource.reload(),
      error: () => this.mutationErrors.show(),
    });
  }
}
