import { Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { forkJoin, of } from 'rxjs';
import { ConfirmService } from '../../core/confirm.service';
import { DisplayCurrencyService } from '../../core/display-currency.service';
import { MutationErrorService } from '../../core/mutation-error.service';
import { AccountRepository } from '../../data/account.repository';
import { ExchangeRateRepository } from '../../data/exchange-rate.repository';
import { InstitutionRepository } from '../../data/institution.repository';
import { TransactionRepository } from '../../data/transaction.repository';
import { convertedOrNull, converterFromRates, CurrencyConverter } from '../../domain/calc/aggregations';
import { accountBalance } from '../../domain/calc/balances';
import { Account } from '../../domain/models/account';
import { ExchangeRate } from '../../domain/models/exchange-rate';
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
  /** The balance converted to the display currency - null when it's already in that currency, or no rate could convert it. */
  convertedBalance: Money | null;
}

interface AccountGroup {
  /** null is the "Sem instituição" bucket - e.g. a cash account. */
  institution: Institution | null;
  rows: AccountRow[];
  /** null when the group mixes currencies and a single subtotal isn't meaningful. */
  subtotal: Money | null;
  convertedSubtotal: Money | null;
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
  private readonly mutationErrors = inject(MutationErrorService);
  private readonly accountRepository = inject(AccountRepository);
  private readonly transactionRepository = inject(TransactionRepository);
  private readonly institutionRepository = inject(InstitutionRepository);
  private readonly exchangeRateRepository = inject(ExchangeRateRepository);
  private readonly confirmService = inject(ConfirmService);
  private readonly router = inject(Router);
  protected readonly displayCurrencyService = inject(DisplayCurrencyService);

  /** Still used per-row (as a badge) - institution is the primary grouping axis now, type no longer is. */
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

  protected readonly displayCurrency = this.displayCurrencyService.currency;

  /** Currencies any account holds, other than the display currency - drives the rate fetch below, mirroring features/dashboard/dashboard.ts. */
  private readonly foreignCurrencies = computed(() => {
    const display = this.displayCurrency();
    const currencies = (this.accountsResource.value() ?? []).map((account) => account.currency);
    return Array.from(new Set(currencies.filter((currency) => currency !== display)));
  });

  protected readonly ratesResource = rxResource({
    params: () => ({ currencies: this.foreignCurrencies(), display: this.displayCurrency() }),
    stream: ({ params }) =>
      params.currencies.length === 0
        ? of([] as ExchangeRate[])
        : forkJoin(params.currencies.map((currency) => this.exchangeRateRepository.getRate(currency, params.display)))
  });

  private readonly converter = computed<CurrencyConverter>(() => converterFromRates(this.ratesResource.value() ?? []));

  protected readonly groups = computed<AccountGroup[]>(() => {
    const accounts = this.accountsResource.value() ?? [];
    const institutions = this.institutionsResource.value() ?? [];
    const transactions = this.transactionsResource.value() ?? [];
    const showArchived = this.showArchived();
    const display = this.displayCurrency();
    const convert = this.converter();

    const visibleAccounts = accounts.filter((account) => showArchived || !account.archived);

    // Keep empty institution groups visible. A newly created institution has
    // no accounts yet, but it must still appear so the save has visible
    // feedback and the institution remains available for editing/deletion.
    return groupAccountsByInstitution(visibleAccounts, institutions, true).map((group) => {
      const rows: AccountRow[] = group.accounts.map((account) => {
        const balance = accountBalance(account, transactions);
        return { account, balance, convertedBalance: convertedOrNull(balance, display, convert) };
      });
      const subtotal = trySum(rows.filter((row) => !row.account.archived).map((row) => row.balance));
      return {
        institution: group.institution,
        rows,
        subtotal,
        convertedSubtotal: subtotal ? convertedOrNull(subtotal, display, convert) : null
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

    this.accountRepository.setArchived(account.id, !account.archived).subscribe({
      next: () => this.accountsResource.reload(),
      error: () => this.mutationErrors.show(),
    });
  }

  protected onSaved(): void {
    this.accountsResource.reload();
    // The account form can create a brand-new institution inline (its own
    // nested InstitutionFormModal) - reload ours too so a just-created
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
