import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { Subscription } from 'rxjs';
import { ConfirmService } from '../../core/confirm.service';
import { DisplayCurrencyService } from '../../core/display-currency.service';
import { MutationErrorService } from '../../core/mutation-error.service';
import { AccountRepository } from '../../data/account.repository';
import { InstitutionRepository } from '../../data/institution.repository';
import { TransactionRepository } from '../../data/transaction.repository';
import { convertedOrNull } from '../../domain/calc/aggregations';
import { creditCardSummary } from '../../domain/calc/balances';
import { Transaction } from '../../domain/models/transaction';
import { money, ratio } from '../../shared/money/money';
import { displayConverter } from '../../shared/money/display-converter';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { Badge } from '../../shared/ui/badge/badge';
import { Button } from '../../shared/ui/button/button';
import { Card } from '../../shared/ui/card/card';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { Icon } from '../../shared/ui/icon/icon';
import { InfiniteScroll } from '../../shared/ui/infinite-scroll/infinite-scroll';
import { ExchangeRateWarning } from '../../shared/exchange-rate-warning/exchange-rate-warning';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { ProgressBar } from '../../shared/ui/progress-bar/progress-bar';
import { AccountFormModal } from './account-form-modal';
import { accountTypeOption } from './account-type';

const PAGE_SIZE = 30;

/**
 * `id` binds directly from the `:id` route param - see
 * withComponentInputBinding() in app.config.ts.
 *
 * The confirmation keys below are passed dynamically through ConfirmService,
 * so the i18n extractor needs explicit markers:
 * t(accounts.archive.title, accounts.archive.message)
 */
@Component({
  selector: 'app-account-detail',
  imports: [
    RouterLink,
    TranslocoDirective,
    MoneyPipe,
    Badge,
    Button,
    Card,
    EmptyState,
    Icon,
    InfiniteScroll,
    PageHeader,
    ProgressBar,
    ExchangeRateWarning,
    AccountFormModal
  ],
  templateUrl: './account-detail.html',
  styleUrl: './account-detail.scss'
})
export class AccountDetail {
  private readonly mutationErrors = inject(MutationErrorService);
  private readonly accountRepository = inject(AccountRepository);
  private readonly transactionRepository = inject(TransactionRepository);
  private readonly institutionRepository = inject(InstitutionRepository);
  private readonly confirmService = inject(ConfirmService);
  private readonly transloco = inject(TranslocoService);
  private readonly router = inject(Router);
  protected readonly displayCurrencyService = inject(DisplayCurrencyService);

  readonly id = input.required<string>();

  protected readonly accountsResource = rxResource({
    stream: () => this.accountRepository.list()
  });
  protected readonly balancesResource = rxResource({
    stream: () => this.accountRepository.balances()
  });
  protected readonly institutionsResource = rxResource({
    stream: () => this.institutionRepository.list()
  });

  // Paginated transaction history for this account - accumulated across
  // loadMore() calls rather than an rxResource, since rxResource replaces
  // its value on every params change and this needs to append instead.
  protected readonly rows = signal<Transaction[]>([]);
  private readonly offset = signal(0);
  protected readonly exhausted = signal(false);
  private loadingMore = false;
  private loadSubscription?: Subscription;

  constructor() {
    // untracked: loadMore() reads `exhausted` synchronously - without
    // untracked that becomes an effect dependency too, and loadMore()'s
    // own `exhausted.set(true)` (in its subscribe callback) would
    // re-trigger this same effect, looping forever.
    effect(() => {
      this.id();
      untracked(() => {
        // Cancel any request still in flight for the previous id - without
        // this, fast navigation between accounts would see loadMore() below
        // no-op (loadingMore is still true from the stale request) and then
        // have that stale request's response land in the just-cleared rows.
        this.loadSubscription?.unsubscribe();
        this.loadingMore = false;
        this.rows.set([]);
        this.offset.set(0);
        this.exhausted.set(false);
        this.loadMore();
      });
    });
  }

  protected loadMore(): void {
    if (this.loadingMore || this.exhausted()) return;
    this.loadingMore = true;
    this.loadSubscription = this.transactionRepository
      .list({ accountId: this.id(), limit: PAGE_SIZE, offset: this.offset() })
      .subscribe({
        next: (page) => {
          this.rows.update((current) => [...current, ...page]);
          this.offset.update((current) => current + page.length);
          if (page.length < PAGE_SIZE) this.exhausted.set(true);
          this.loadingMore = false;
        },
        error: () => {
          this.loadingMore = false;
        },
      });
  }

  protected readonly account = computed(() =>
    this.accountsResource.value()?.find((account) => account.id === this.id())
  );

  protected readonly institutionName = computed(() => {
    const account = this.account();
    if (!account) return undefined;
    const institution = this.institutionsResource
      .value()
      ?.find((institution) => institution.id === account.institutionId);
    return institution ? institution.name : this.transloco.translate('accounts.noInstitution');
  });

  protected readonly typeOption = computed(() => {
    const account = this.account();
    return account ? accountTypeOption(account.type) : undefined;
  });

  protected readonly balance = computed(() => {
    const account = this.account();
    if (!account) return undefined;
    const row = this.balancesResource.value()?.find((b) => b.accountId === account.id);
    return row ? money(row.balance, row.currency) : money('0', account.currency);
  });

  protected readonly displayCurrency = this.displayCurrencyService.currency;

  private readonly accountCurrency = computed(() => {
    const currency = this.account()?.currency;
    const display = this.displayCurrency();
    return currency && currency !== display ? [currency] : [];
  });

  private readonly rates = displayConverter(() => this.accountCurrency());
  private readonly converter = this.rates.converter;
  protected readonly hasFallbackRate = this.rates.hasFallbackRate;

  /** The balance converted to the display currency - null when it's already in that currency, or no rate has arrived (yet) to convert it. */
  protected readonly convertedBalance = computed(() => {
    const balance = this.balance();
    const convert = this.converter();
    if (!balance || !convert) return null;
    return convertedOrNull(balance, this.displayCurrency(), convert);
  });

  protected readonly creditCard = computed(() => {
    const account = this.account();
    const balance = this.balance();
    if (!account || !balance || account.type !== 'credit_card') return undefined;
    return creditCardSummary(account, balance);
  });

  protected readonly creditCardRatio = computed(() => {
    const card = this.creditCard();
    if (!card) return 0;
    return card.limit.amount === '0.0000' ? 0 : ratio(card.owed, card.limit);
  });

  protected readonly formOpen = signal(false);

  protected openEdit(): void {
    this.formOpen.set(true);
  }

  protected async toggleArchived(): Promise<void> {
    const account = this.account();
    if (!account) return;
    if (!account.archived) {
      const confirmed = await this.confirmService.confirm(
        'accounts.archive.title',
        'accounts.archive.message',
        'default',
        { name: account.name }
      );
      if (!confirmed) return;
    }

    this.accountRepository.setArchived(account.id, !account.archived).subscribe({
      next: () => this.accountsResource.reload(),
      error: () => this.mutationErrors.show(),
    });
  }

  protected onSaved(): void {
    this.accountsResource.reload();
    this.balancesResource.reload();
    // See accounts.ts's onSaved for why: the account form can create a
    // brand-new institution inline via its own nested InstitutionFormModal.
    this.institutionsResource.reload();
  }

  protected goBack(): void {
    this.router.navigate(['/accounts']);
  }

  protected transactionSign(accountId: string, tx: { accountId: string; type: string }): 'in' | 'out' {
    if (tx.type === 'income' || tx.type === 'interest') return 'in';
    if (tx.type === 'expense') return 'out';
    // transfer: incoming if this account is the destination, outgoing if it's the source
    return tx.accountId === accountId ? 'out' : 'in';
  }
}
