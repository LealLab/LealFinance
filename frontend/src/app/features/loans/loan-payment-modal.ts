import { Component, computed, effect, inject, input, model, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslocoDirective } from '@jsverse/transloco';
import { LoanRepository } from '../../data/loan.repository';
import { formatIsoDate } from '../../domain/calc/dates';
import { loanProgress } from '../../domain/calc/loans';
import { Account } from '../../domain/models/account';
import { Institution } from '../../domain/models/institution';
import { Loan } from '../../domain/models/loan';
import { groupAccountsByInstitution } from '../accounts/institution-grouping';
import { decimalAmountValidator } from '../../shared/money/decimal-amount.validator';
import { Button } from '../../shared/ui/button/button';
import { Modal } from '../../shared/ui/modal/modal';

/** t(loans.payment.title, loans.payment.saveError) */

@Component({
  selector: 'app-loan-payment-modal',
  imports: [ReactiveFormsModule, TranslocoDirective, Button, Modal],
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
  readonly saved = output<void>();

  protected readonly saving = signal(false);
  protected readonly saveErrorKey = signal<string | null>(null);

  protected readonly eligibleAccounts = computed(() =>
    this.accounts().filter(
      (account) => !account.archived && account.currency === this.loan().currency,
    ),
  );

  protected readonly accountGroups = computed(() =>
    groupAccountsByInstitution(this.eligibleAccounts(), this.institutions()),
  );

  protected readonly form = this.fb.nonNullable.group({
    amount: ['', [Validators.required, decimalAmountValidator()]],
    date: [formatIsoDate(new Date()), Validators.required],
    accountId: ['', Validators.required],
    description: ['', Validators.required],
  });

  constructor() {
    effect(() => {
      if (!this.open()) return;
      const loan = this.loan();
      const progress = loanProgress(loan);
      this.form.reset({
        amount: loan.installmentAmount,
        date: progress.nextDueDate ?? formatIsoDate(new Date()),
        accountId: loan.paymentAccountId ?? this.eligibleAccounts()[0]?.id ?? '',
        description: `${loan.name} ${Math.min(progress.paid + 1, loan.installmentCount)}/${loan.installmentCount}`,
      });
      this.saveErrorKey.set(null);
    });
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const raw = this.form.getRawValue();
    this.saving.set(true);
    this.loans
      .recordPayment(this.loan().id, {
        amount: raw.amount,
        date: raw.date,
        accountId: raw.accountId,
        description: raw.description.trim(),
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.open.set(false);
          this.saved.emit();
        },
        error: () => {
          this.saving.set(false);
          this.saveErrorKey.set('loans.payment.saveError');
        },
      });
  }
}
