import { Component, computed, effect, inject, input, model, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslocoDirective } from '@jsverse/transloco';
import { Observable } from 'rxjs';
import { ApiError } from '../../core/api-error';
import { LoanRepository } from '../../data/loan.repository';
import { todayIso } from '../../domain/calc/dates';
import {
  LoanPaymentMode,
  LoanPaymentQuote,
  loanPaymentQuote,
  loanProgress,
  openLoanInstallments,
} from '../../domain/calc/loans';
import { Account } from '../../domain/models/account';
import { Institution } from '../../domain/models/institution';
import { Loan } from '../../domain/models/loan';
import { Transaction } from '../../domain/models/transaction';
import { groupAccountsByInstitution } from '../accounts/institution-grouping';
import { decimalAmountValidator } from '../../shared/money/decimal-amount.validator';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { Button } from '../../shared/ui/button/button';
import { Modal } from '../../shared/ui/modal/modal';

/** t(loans.payment.title, loans.payment.saveError) */

@Component({
  selector: 'app-loan-payment-modal',
  imports: [ReactiveFormsModule, TranslocoDirective, MoneyPipe, Button, Modal],
  templateUrl: './loan-payment-modal.html',
  styleUrl: './loan-payment-modal.scss',
})
export class LoanPaymentModal {
  private readonly loans = inject(LoanRepository);
  private readonly fb = inject(FormBuilder);

  readonly open = model.required<boolean>();
  readonly loan = input.required<Loan>();
  readonly accounts = input<Account[]>([]);
  readonly institutions = input<Institution[]>([]);
  readonly transactions = input<Transaction[]>([]);
  readonly saved = output<void>();

  protected readonly saving = signal(false);
  protected readonly saveErrorKey = signal<string | null>(null);
  protected readonly quote = signal<LoanPaymentQuote | undefined>(undefined);

  protected readonly eligibleAccounts = computed(() =>
    this.accounts().filter(
      (account) => !account.archived && account.currency === this.loan().currency,
    ),
  );

  protected readonly accountGroups = computed(() =>
    groupAccountsByInstitution(this.eligibleAccounts(), this.institutions()),
  );

  protected readonly pendingCount = computed(
    () => openLoanInstallments(this.loan(), this.transactions()).length,
  );

  protected readonly form = this.fb.nonNullable.group({
    mode: ['next' as LoanPaymentMode, Validators.required],
    count: [1, [Validators.required, Validators.min(1)]],
    amount: ['', [Validators.required, decimalAmountValidator(), Validators.min(0.0001)]],
    date: [todayIso(), Validators.required],
    accountId: ['', Validators.required],
    description: [''],
  });

  constructor() {
    this.form.controls.date.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.refreshSuggestion());
    this.form.controls.count.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.refreshSuggestion());
    this.form.controls.mode.valueChanges.pipe(takeUntilDestroyed()).subscribe((mode) => {
      if (!this.open()) return;
      const progress = loanProgress(this.loan(), this.transactions());
      this.form.controls.date.setValue(
        mode === 'next' ? (progress.nextDueDate ?? todayIso()) : todayIso(),
        { emitEvent: false },
      );
      this.form.controls.description.setValue(
        mode === 'next' ? this.defaultNextDescription() : '',
        { emitEvent: false },
      );
      this.refreshSuggestion();
    });

    effect(() => {
      if (!this.open()) return;
      const loan = this.loan();
      const progress = loanProgress(loan, this.transactions());
      this.form.reset({
        mode: 'next',
        count: 1,
        amount: '',
        date: progress.nextDueDate ?? todayIso(),
        accountId: loan.paymentAccountId ?? this.eligibleAccounts()[0]?.id ?? '',
        description: this.defaultNextDescription(),
      });
      this.refreshSuggestion();
      this.saveErrorKey.set(null);
    });
  }

  private defaultNextDescription(): string {
    const loan = this.loan();
    const number = openLoanInstallments(loan, this.transactions())[0]?.number ?? loan.installmentCount;
    return `${loan.name} ${number}/${loan.installmentCount}`;
  }

  private refreshSuggestion(): void {
    if (!this.open()) return;
    const raw = this.form.getRawValue();
    const quote = loanPaymentQuote(
      this.loan(),
      this.transactions(),
      raw.mode,
      raw.date,
      Number(raw.count) || 0,
    );
    this.quote.set(quote);
    this.form.controls.amount.setValue(quote.suggestedAmount.amount, { emitEvent: false });
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const raw = this.form.getRawValue();
    if (raw.mode === 'last' && Number(raw.count) > this.pendingCount()) {
      this.form.controls.count.setErrors({ max: true });
      this.form.controls.count.markAsTouched();
      return;
    }
    this.saving.set(true);
    const payment = {
      amount: raw.amount,
      date: raw.date,
      accountId: raw.accountId,
      description: raw.description.trim() || undefined,
    };
    const operation: Observable<unknown> =
      raw.mode === 'next'
        ? this.loans.recordPayment(this.loan().id, payment)
        : this.loans.advancePayments(this.loan().id, {
            ...payment,
            mode: raw.mode,
            count: raw.mode === 'last' ? Number(raw.count) : undefined,
          });
    operation.subscribe({
        next: () => {
          this.saving.set(false);
          this.open.set(false);
          this.saved.emit();
        },
        error: (error: unknown) => {
          this.saving.set(false);
          const code = error instanceof ApiError ? error.code : undefined;
          this.saveErrorKey.set(
            code === 'loan.advance_amount_too_small' ||
              code === 'loan.advance_count_exceeds_remaining'
              ? `errors.${code}`
              : 'loans.payment.saveError',
          );
        },
      });
  }
}
