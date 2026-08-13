import { Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { AccountRepository } from '../../data/account.repository';
import { TransactionRepository } from '../../data/transaction.repository';
import { accountBalance } from '../../domain/calc/balances';
import { Account } from '../../domain/models/account';
import { Money, sum } from '../../shared/money/money';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { Badge } from '../../shared/ui/badge/badge';
import { Button } from '../../shared/ui/button/button';
import { Card } from '../../shared/ui/card/card';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { Icon } from '../../shared/ui/icon/icon';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { AccountFormModal } from './account-form-modal';
import { ACCOUNT_TYPE_OPTIONS, AccountTypeOption } from './account-type';

interface AccountRow {
  account: Account;
  balance: Money;
}

interface AccountGroup {
  option: AccountTypeOption;
  rows: AccountRow[];
  /** null when the group mixes currencies and a single subtotal isn't meaningful. */
  subtotal: Money | null;
}

/** Sums same-currency amounts; returns null instead of throwing on a mismatch. */
function trySum(amounts: Money[]): Money | null {
  if (amounts.length === 0) return null;
  try {
    return sum(amounts, amounts[0].currency);
  } catch {
    return null;
  }
}

@Component({
  selector: 'app-accounts',
  imports: [
    TranslocoDirective,
    MoneyPipe,
    Badge,
    Button,
    Card,
    EmptyState,
    Icon,
    PageHeader,
    AccountFormModal
  ],
  templateUrl: './accounts.html',
  styleUrl: './accounts.scss'
})
export class Accounts {
  private readonly accountRepository = inject(AccountRepository);
  private readonly transactionRepository = inject(TransactionRepository);
  private readonly router = inject(Router);

  protected readonly accountTypeOptions = ACCOUNT_TYPE_OPTIONS;

  protected readonly accountsResource = rxResource({
    stream: () => this.accountRepository.list()
  });
  protected readonly transactionsResource = rxResource({
    stream: () => this.transactionRepository.list()
  });

  protected readonly showArchived = signal(false);
  protected readonly formOpen = signal(false);
  protected readonly editingAccount = signal<Account | undefined>(undefined);

  protected readonly groups = computed<AccountGroup[]>(() => {
    const accounts = this.accountsResource.value() ?? [];
    const transactions = this.transactionsResource.value() ?? [];
    const showArchived = this.showArchived();

    return this.accountTypeOptions
      .map((option) => {
        const rows: AccountRow[] = accounts
          .filter((account) => account.type === option.type && (showArchived || !account.archived))
          .map((account) => ({ account, balance: accountBalance(account, transactions) }));
        return {
          option,
          rows,
          subtotal: trySum(rows.filter((row) => !row.account.archived).map((row) => row.balance))
        };
      })
      .filter((group) => group.rows.length > 0);
  });

  protected readonly isEmpty = computed(
    () => !this.accountsResource.isLoading() && this.groups().length === 0
  );

  protected openCreate(): void {
    this.editingAccount.set(undefined);
    this.formOpen.set(true);
  }

  protected openEdit(account: Account, event: Event): void {
    event.stopPropagation();
    this.editingAccount.set(account);
    this.formOpen.set(true);
  }

  protected toggleArchived(account: Account, event: Event): void {
    event.stopPropagation();
    this.accountRepository.setArchived(account.id, !account.archived).subscribe(() => {
      this.accountsResource.reload();
    });
  }

  protected onSaved(): void {
    this.accountsResource.reload();
  }

  protected openDetail(account: Account): void {
    this.router.navigate(['/accounts', account.id]);
  }
}
