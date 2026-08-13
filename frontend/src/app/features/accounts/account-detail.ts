import { Component, computed, inject, input, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { AccountRepository } from '../../data/account.repository';
import { TransactionRepository } from '../../data/transaction.repository';
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
 * `id` binds directly from the `:id` route param — see
 * withComponentInputBinding() in app.config.ts.
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
  private readonly router = inject(Router);

  readonly id = input.required<string>();

  protected readonly accountsResource = rxResource({
    stream: () => this.accountRepository.list()
  });
  protected readonly transactionsResource = rxResource({
    stream: () => this.transactionRepository.list()
  });

  protected readonly account = computed(() =>
    this.accountsResource.value()?.find((account) => account.id === this.id())
  );

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

  protected toggleArchived(): void {
    const account = this.account();
    if (!account) return;
    this.accountRepository.setArchived(account.id, !account.archived).subscribe(() => {
      this.accountsResource.reload();
    });
  }

  protected onSaved(): void {
    this.accountsResource.reload();
  }

  protected goBack(): void {
    this.router.navigate(['/accounts']);
  }

  protected transactionSign(accountId: string, tx: { accountId: string; type: string }): 'in' | 'out' {
    if (tx.type === 'income') return 'in';
    if (tx.type === 'expense') return 'out';
    // transfer: incoming if this account is the destination, outgoing if it's the source
    return tx.accountId === accountId ? 'out' : 'in';
  }
}
