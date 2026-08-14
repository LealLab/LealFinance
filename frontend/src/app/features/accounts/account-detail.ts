import { Component, computed, inject, input, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { of } from 'rxjs';
import { ConfirmService } from '../../core/confirm.service';
import { DisplayCurrencyService } from '../../core/display-currency.service';
import { AccountRepository } from '../../data/account.repository';
import { ExchangeRateRepository } from '../../data/exchange-rate.repository';
import { InstitutionRepository } from '../../data/institution.repository';
import { TransactionRepository } from '../../data/transaction.repository';
import { convertedOrNull, converterFromRates } from '../../domain/calc/aggregations';
import { accountBalance, creditCardSummary } from '../../domain/calc/balances';
import { ratio } from '../../shared/money/money';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { Badge } from '../../shared/ui/badge/badge';
import { Button } from '../../shared/ui/button/button';
import { Card } from '../../shared/ui/card/card';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { Icon } from '../../shared/ui/icon/icon';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { ProgressBar } from '../../shared/ui/progress-bar/progress-bar';
import { AccountFormModal } from './account-form-modal';
import { accountTypeOption } from './account-type';

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
    PageHeader,
    ProgressBar,
    AccountFormModal
  ],
  templateUrl: './account-detail.html',
  styleUrl: './account-detail.scss'
})
export class AccountDetail {
  private readonly accountRepository = inject(AccountRepository);
  private readonly transactionRepository = inject(TransactionRepository);
  private readonly institutionRepository = inject(InstitutionRepository);
  private readonly exchangeRateRepository = inject(ExchangeRateRepository);
  private readonly confirmService = inject(ConfirmService);
  private readonly transloco = inject(TranslocoService);
  private readonly router = inject(Router);
  protected readonly displayCurrencyService = inject(DisplayCurrencyService);

  readonly id = input.required<string>();

  protected readonly accountsResource = rxResource({
    stream: () => this.accountRepository.list()
  });
  protected readonly transactionsResource = rxResource({
    stream: () => this.transactionRepository.list()
  });
  protected readonly institutionsResource = rxResource({
    stream: () => this.institutionRepository.list()
  });

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

  protected readonly accountTransactions = computed(() => {
    const id = this.id();
    return (this.transactionsResource.value() ?? [])
      .filter((tx) => tx.accountId === id || tx.toAccountId === id)
      .sort((a, b) => b.date.localeCompare(a.date));
  });

  protected readonly balance = computed(() => {
    const account = this.account();
    return account ? accountBalance(account, this.transactionsResource.value() ?? []) : undefined;
  });

  protected readonly displayCurrency = this.displayCurrencyService.currency;

  protected readonly ratesResource = rxResource({
    params: () => {
      const currency = this.account()?.currency;
      const display = this.displayCurrency();
      return { currency: currency && currency !== display ? currency : undefined, display };
    },
    stream: ({ params }) =>
      params.currency ? this.exchangeRateRepository.getRate(params.currency, params.display) : of(undefined)
  });

  /** The balance converted to the display currency - null when it's already in that currency, or no rate could convert it. */
  protected readonly convertedBalance = computed(() => {
    const balance = this.balance();
    const rate = this.ratesResource.value();
    if (!balance || !rate) return null;
    return convertedOrNull(balance, this.displayCurrency(), converterFromRates([rate]));
  });

  protected readonly creditCard = computed(() => {
    const account = this.account();
    if (!account || account.type !== 'credit_card') return undefined;
    return creditCardSummary(account, this.transactionsResource.value() ?? []);
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

    this.accountRepository.setArchived(account.id, !account.archived).subscribe(() => {
      this.accountsResource.reload();
    });
  }

  protected onSaved(): void {
    this.accountsResource.reload();
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
