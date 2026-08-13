import { Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { ConfirmService } from '../../core/confirm.service';
import { AccountRepository } from '../../data/account.repository';
import { InstitutionRepository } from '../../data/institution.repository';
import { TransactionRepository } from '../../data/transaction.repository';
import { accountBalance } from '../../domain/calc/balances';
import { Account } from '../../domain/models/account';
import { Institution } from '../../domain/models/institution';
import { Money, sum } from '../../shared/money/money';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { Badge } from '../../shared/ui/badge/badge';
import { Button } from '../../shared/ui/button/button';
import { Card } from '../../shared/ui/card/card';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { Icon } from '../../shared/ui/icon/icon';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { AccountFormModal } from './account-form-modal';
import { accountTypeOption } from './account-type';
import { groupAccountsByInstitution } from './institution-grouping';
import { InstitutionFormModal } from './institution-form-modal';

interface AccountRow {
  account: Account;
  balance: Money;
}

interface AccountGroup {
  /** null is the "Sem instituição" bucket — e.g. a cash account. */
  institution: Institution | null;
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
    AccountFormModal,
    InstitutionFormModal
  ],
  templateUrl: './accounts.html',
  styleUrl: './accounts.scss'
})
export class Accounts {
  private readonly accountRepository = inject(AccountRepository);
  private readonly transactionRepository = inject(TransactionRepository);
  private readonly institutionRepository = inject(InstitutionRepository);
  private readonly confirmService = inject(ConfirmService);
  private readonly router = inject(Router);

  /** Still used per-row (as a badge) — institution is the primary grouping axis now, type no longer is. */
  protected readonly accountTypeOption = accountTypeOption;

  protected readonly accountsResource = rxResource({
    stream: () => this.accountRepository.list()
  });
  protected readonly transactionsResource = rxResource({
    stream: () => this.transactionRepository.list()
  });
  protected readonly institutionsResource = rxResource({
    stream: () => this.institutionRepository.list()
  });

  protected readonly showArchived = signal(false);
  protected readonly formOpen = signal(false);
  protected readonly editingAccount = signal<Account | undefined>(undefined);
  protected readonly institutionFormOpen = signal(false);
  protected readonly editingInstitution = signal<Institution | undefined>(undefined);

  protected readonly groups = computed<AccountGroup[]>(() => {
    const accounts = this.accountsResource.value() ?? [];
    const institutions = this.institutionsResource.value() ?? [];
    const transactions = this.transactionsResource.value() ?? [];
    const showArchived = this.showArchived();

    const visibleAccounts = accounts.filter((account) => showArchived || !account.archived);

    // Keep empty institution groups visible. A newly created institution has
    // no accounts yet, but it must still appear so the save has visible
    // feedback and the institution remains available for editing/deletion.
    return groupAccountsByInstitution(visibleAccounts, institutions, true).map((group) => {
      const rows: AccountRow[] = group.accounts.map((account) => ({
        account,
        balance: accountBalance(account, transactions)
      }));
      return {
        institution: group.institution,
        rows,
        subtotal: trySum(rows.filter((row) => !row.account.archived).map((row) => row.balance))
      };
    });
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

  protected async toggleArchived(account: Account, event: Event): Promise<void> {
    event.stopPropagation();
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
    // The account form can create a brand-new institution inline (its own
    // nested InstitutionFormModal) — reload ours too so a just-created
    // institution's group shows up immediately instead of the account
    // landing in "Sem instituição" until the next full reload.
    this.institutionsResource.reload();
  }

  protected openDetail(account: Account): void {
    this.router.navigate(['/accounts', account.id]);
  }

  protected openCreateInstitution(): void {
    this.editingInstitution.set(undefined);
    this.institutionFormOpen.set(true);
  }

  protected openEditInstitution(institution: Institution, event: Event): void {
    event.stopPropagation();
    this.editingInstitution.set(institution);
    this.institutionFormOpen.set(true);
  }

  protected onInstitutionSaved(): void {
    this.institutionsResource.reload();
  }

  protected onInstitutionDeleted(): void {
    this.institutionsResource.reload();
  }
}
