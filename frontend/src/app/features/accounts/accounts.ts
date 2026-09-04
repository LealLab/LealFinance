import { Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { ConfirmService } from '../../core/confirm.service';
import { DisplayCurrencyService } from '../../core/display-currency.service';
import { MutationErrorService } from '../../core/mutation-error.service';
import { openOnNewParam } from '../../core/open-on-new-param';
import { AccountRepository } from '../../data/account.repository';
import { InstitutionRepository } from '../../data/institution.repository';
import { convertedOrNull } from '../../domain/calc/aggregations';
import { Account } from '../../domain/models/account';
import { Institution } from '../../domain/models/institution';
import { isNegative, isZero, money, Money, sum } from '../../shared/money/money';
import { displayConverter } from '../../shared/money/display-converter';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { Badge } from '../../shared/ui/badge/badge';
import { Button } from '../../shared/ui/button/button';
import { Card } from '../../shared/ui/card/card';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { Icon } from '../../shared/ui/icon/icon';
import { ExchangeRateWarning } from '../../shared/exchange-rate-warning/exchange-rate-warning';
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
    ExchangeRateWarning,
    AccountFormModal,
    InstitutionFormModal
  ],
  templateUrl: './accounts.html',
})
export class Accounts {
  private readonly mutationErrors = inject(MutationErrorService);
  private readonly accountRepository = inject(AccountRepository);
  private readonly institutionRepository = inject(InstitutionRepository);
  private readonly confirmService = inject(ConfirmService);
  private readonly router = inject(Router);
  protected readonly displayCurrencyService = inject(DisplayCurrencyService);

  /** Still used per-row (as a badge) - institution is the primary grouping axis now, type no longer is. */
  protected readonly accountTypeOption = accountTypeOption;

  protected readonly accountsResource = rxResource({
    stream: () => this.accountRepository.list()
  });
  protected readonly balancesResource = rxResource({
    stream: () => this.accountRepository.balances()
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

  private readonly rates = displayConverter(() => this.foreignCurrencies());
  private readonly converter = this.rates.converter;
  protected readonly hasFallbackRate = this.rates.hasFallbackRate;

  constructor() {
    openOnNewParam(() => this.openCreate());
  }

  protected readonly balanceByAccountId = computed(
    () => new Map((this.balancesResource.value() ?? []).map((b) => [b.accountId, b]))
  );

  protected readonly groups = computed<AccountGroup[]>(() => {
    const accounts = this.accountsResource.value() ?? [];
    const institutions = this.institutionsResource.value() ?? [];
    const balanceByAccountId = this.balanceByAccountId();
    const showArchived = this.showArchived();
    const display = this.displayCurrency();
    const convert = this.converter();

    const visibleAccounts = accounts.filter((account) => showArchived || !account.archived);

    // Keep empty institution groups visible. A newly created institution has
    // no accounts yet, but it must still appear so the save has visible
    // feedback and the institution remains available for editing/deletion.
    return groupAccountsByInstitution(visibleAccounts, institutions, true).map((group) => {
      const rows: AccountRow[] = group.accounts.map((account) => {
        const row = balanceByAccountId.get(account.id);
        const balance = row ? money(row.balance, row.currency) : money('0', account.currency);
        return {
          account,
          balance,
          convertedBalance: convert ? convertedOrNull(balance, display, convert) : null
        };
      });
      const subtotal = trySum(rows.filter((row) => !row.account.archived).map((row) => row.balance));
      return {
        institution: group.institution,
        rows,
        subtotal,
        convertedSubtotal: subtotal && convert ? convertedOrNull(subtotal, display, convert) : null
      };
    });
  });

  protected readonly isEmpty = computed(
    () => !this.accountsResource.isLoading() && this.groups().length === 0
  );

  protected amountClass(value: Money): string {
    if (isZero(value)) return 'text-content-primary';
    return isNegative(value) ? 'text-negative' : 'text-positive';
  }

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
    this.balancesResource.reload();
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
