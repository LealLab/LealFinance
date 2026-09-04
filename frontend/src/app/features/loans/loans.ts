import { Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { TranslocoDirective } from '@jsverse/transloco';
import { DisplayCurrencyService } from '../../core/display-currency.service';
import { AccountRepository } from '../../data/account.repository';
import { CategoryRepository } from '../../data/category.repository';
import { InstitutionRepository } from '../../data/institution.repository';
import { LoanRepository } from '../../data/loan.repository';
import { TransactionRepository } from '../../data/transaction.repository';
import { convertedOrNull } from '../../domain/calc/aggregations';
import { LoanProgress, LoanScheduleRow, loanProgress, loanSchedule } from '../../domain/calc/loans';
import { Category } from '../../domain/models/category';
import { Loan } from '../../domain/models/loan';
import { Transaction } from '../../domain/models/transaction';
import { Money } from '../../shared/money/money';
import { displayConverter } from '../../shared/money/display-converter';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { Badge } from '../../shared/ui/badge/badge';
import { Button } from '../../shared/ui/button/button';
import { Card } from '../../shared/ui/card/card';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { Icon } from '../../shared/ui/icon/icon';
import { ExchangeRateWarning } from '../../shared/exchange-rate-warning/exchange-rate-warning';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { ProgressBar } from '../../shared/ui/progress-bar/progress-bar';
import { LoanFormModal } from './loan-form-modal';
import { LoanPaymentModal } from './loan-payment-modal';

interface LoanRow {
  loan: Loan;
  category: Category | undefined;
  progress: LoanProgress;
  /** installment / remaining converted to the display currency - null when already in it, or unconvertible. */
  convertedInstallment: Money | null;
  convertedRemaining: Money | null;
}

/** t(loans.archiveError) */

@Component({
  selector: 'app-loans',
  imports: [
    TranslocoDirective,
    MoneyPipe,
    Badge,
    Button,
    Card,
    EmptyState,
    Icon,
    PageHeader,
    ProgressBar,
    ExchangeRateWarning,
    LoanFormModal,
    LoanPaymentModal,
  ],
  templateUrl: './loans.html',
  styleUrl: './loans.scss',
})
export class Loans {
  private readonly loanRepository = inject(LoanRepository);
  private readonly accountRepository = inject(AccountRepository);
  private readonly categoryRepository = inject(CategoryRepository);
  private readonly institutionRepository = inject(InstitutionRepository);
  private readonly transactionRepository = inject(TransactionRepository);
  protected readonly displayCurrencyService = inject(DisplayCurrencyService);

  protected readonly loansResource = rxResource({ stream: () => this.loanRepository.list() });
  protected readonly accountsResource = rxResource({ stream: () => this.accountRepository.list() });
  protected readonly categoriesResource = rxResource({
    stream: () => this.categoryRepository.list(),
  });
  protected readonly institutionsResource = rxResource({
    stream: () => this.institutionRepository.list(),
  });
  protected readonly transactionsResource = rxResource({
    stream: () => this.transactionRepository.list(),
  });

  protected readonly showArchived = signal(false);
  protected readonly formOpen = signal(false);
  protected readonly editingLoan = signal<Loan | undefined>(undefined);
  protected readonly paymentOpen = signal(false);
  protected readonly paymentLoan = signal<Loan | undefined>(undefined);
  protected readonly actionErrorKey = signal<string | undefined>(undefined);

  protected readonly displayCurrency = this.displayCurrencyService.currency;

  protected readonly categoriesById = computed(
    () => new Map((this.categoriesResource.value() ?? []).map((category) => [category.id, category])),
  );

  private readonly foreignCurrencies = computed(() => {
    const display = this.displayCurrency();
    const currencies = (this.loansResource.value() ?? []).map((loan) => loan.currency);
    return Array.from(new Set(currencies.filter((currency) => currency !== display)));
  });

  private readonly rates = displayConverter(() => this.foreignCurrencies());
  private readonly converter = this.rates.converter;
  protected readonly hasFallbackRate = this.rates.hasFallbackRate;

  protected readonly rows = computed<LoanRow[]>(() => {
    const categories = this.categoriesById();
    const display = this.displayCurrency();
    const convert = this.converter();
    const transactions = this.transactionsResource.value() ?? [];
    return (this.loansResource.value() ?? [])
      .filter((loan) => this.showArchived() || !loan.archived)
      .map((loan) => {
        const progress = loanProgress(loan, transactions);
        return {
          loan,
          category: categories.get(loan.categoryId),
          progress,
          convertedInstallment: convert
            ? convertedOrNull(
                { amount: loan.installmentAmount, currency: loan.currency },
                display,
                convert,
              )
            : null,
          convertedRemaining: convert
            ? convertedOrNull(progress.remaining, display, convert)
            : null,
        };
      });
  });

  protected readonly isEmpty = computed(
    () => !this.loansResource.isLoading() && this.rows().length === 0,
  );

  protected readonly expenseCategories = computed(() =>
    (this.categoriesResource.value() ?? []).filter((category) => category.kind === 'expense'),
  );

  protected openCreate(): void {
    this.editingLoan.set(undefined);
    this.formOpen.set(true);
  }

  protected openEdit(loan: Loan): void {
    this.editingLoan.set(loan);
    this.formOpen.set(true);
  }

  /** `advance` = the "pay now" button: same modal, just prefilled with today rather than the due date. */
  protected openPayment(loan: Loan): void {
    this.paymentLoan.set(loan);
    this.paymentOpen.set(true);
  }

  protected onLoanSaved(): void {
    this.loansResource.reload();
  }

  protected onPaymentSaved(): void {
    this.loansResource.reload();
    this.accountsResource.reload();
    this.transactionsResource.reload();
  }

  protected loanTransactions(loan: Loan): Transaction[] {
    return (this.transactionsResource.value() ?? [])
      .filter((transaction) => transaction.loanId === loan.id)
      .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  }

  /**
   * A stable array reference for the payment modal's `transactions` input.
   * Unlike `loanTransactions()`, called fresh from the template every change
   * detection cycle, this only recomputes when the open loan or the
   * underlying resource actually changes - otherwise the modal's reset
   * effect (which reads this input) would fire on every tick and snap the
   * payment mode back to "next" as soon as the user picked something else.
   */
  protected readonly paymentLoanTransactions = computed<Transaction[]>(() => {
    const loan = this.paymentLoan();
    return loan ? this.loanTransactions(loan) : [];
  });

  protected loanSchedule(loan: Loan): LoanScheduleRow[] {
    return loanSchedule(loan, this.transactionsResource.value() ?? []);
  }

  protected archive(loan: Loan): void {
    this.loanRepository.setArchived(loan.id, !loan.archived).subscribe({
      next: () => this.loansResource.reload(),
      error: () => this.actionErrorKey.set('loans.archiveError'),
    });
  }
}
