import { Component, computed, effect, inject, input, model, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslocoDirective } from '@jsverse/transloco';
import { ApiError } from '../../core/api-error';
import { MetadataService } from '../../core/metadata.service';
import { PreferenceService } from '../../core/preference.service';
import { LoanRepository } from '../../data/loan.repository';
import { installmentAmount, interestRateForInstallment } from '../../domain/calc/loans';
import { todayIso } from '../../domain/calc/dates';
import { Account } from '../../domain/models/account';
import { Category } from '../../domain/models/category';
import { Institution } from '../../domain/models/institution';
import { Loan, LoanRatePeriod } from '../../domain/models/loan';
import { decimalAmountValidator } from '../../shared/money/decimal-amount.validator';
import { money } from '../../shared/money/money';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { Button } from '../../shared/ui/button/button';
import { Modal } from '../../shared/ui/modal/modal';

const RATE_PERIODS: readonly LoanRatePeriod[] = ['annual', 'monthly'];

/** t(loans.form.newTitle, loans.form.editTitle, loans.form.saveError) */

@Component({
  selector: 'app-loan-form-modal',
  imports: [ReactiveFormsModule, TranslocoDirective, MoneyPipe, Button, Modal],
  templateUrl: './loan-form-modal.html',
  styleUrl: './loan-form-modal.scss',
})
export class LoanFormModal {
  private readonly loans = inject(LoanRepository);
  private readonly metadata = inject(MetadataService);
  private readonly preferences = inject(PreferenceService);
  private readonly fb = inject(FormBuilder);

  readonly open = model.required<boolean>();
  readonly loan = input<Loan | undefined>(undefined);
  readonly expenseCategories = input<Category[]>([]);
  readonly accounts = input<Account[]>([]);
  readonly institutions = input<Institution[]>([]);
  readonly saved = output<void>();

  protected readonly ratePeriods = RATE_PERIODS;
  protected readonly currencyOptions = computed(() =>
    this.metadata.currencies().map((row) => row.code),
  );
  private readonly baseCurrency = computed(
    () => this.preferences.preferences()?.baseCurrency ?? 'USD',
  );
  protected readonly saving = signal(false);
  protected readonly saveErrorKey = signal<string | null>(null);
  protected readonly isEditing = computed(() => this.loan() !== undefined);
  protected readonly titleKey = computed(() =>
    this.loan() ? 'loans.form.editTitle' : 'loans.form.newTitle',
  );

  protected readonly form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    categoryId: ['', Validators.required],
    currency: [this.baseCurrency(), Validators.required],
    amountBorrowed: ['', [Validators.required, decimalAmountValidator()]],
    fees: ['0', [Validators.required, decimalAmountValidator()]],
    interestRate: ['0', [Validators.required, decimalAmountValidator()]],
    ratePeriod: ['annual' as LoanRatePeriod, Validators.required],
    installmentCount: [12, [Validators.required, Validators.min(1)]],
    contractedInstallmentAmount: ['', [decimalAmountValidator(), Validators.min(0.0001)]],
    adjustInterestRate: [false],
    firstPaymentDate: [todayIso(), Validators.required],
    notes: [''],
    autoPost: [false],
    institutionId: [''],
    paymentAccountId: [''],
  });

  private readonly formValue = signal(this.form.getRawValue());

  /** Accounts eligible as the funding source: active and in the loan's currency. */
  protected readonly eligibleAccounts = computed(() => {
    const value = this.formValue();
    return this.accounts().filter(
      (account) =>
        !account.archived &&
        account.currency === value.currency &&
        (!value.institutionId || account.institutionId === value.institutionId),
    );
  });

  /** Institutions that actually hold an eligible account, plus whatever the "no institution" bucket needs. */
  protected readonly institutionOptions = computed(() => {
    const value = this.formValue();
    const eligible = this.accounts().filter(
      (account) => !account.archived && account.currency === value.currency,
    );
    const ids = new Set(eligible.map((account) => account.institutionId).filter(Boolean));
    return this.institutions().filter((institution) => ids.has(institution.id));
  });

  protected readonly installmentPreview = computed(() => {
    const value = this.formValue();
    const amount = installmentAmount({
      amountBorrowed: value.amountBorrowed || '0',
      fees: value.fees || '0',
      interestRate: value.interestRate || '0',
      ratePeriod: value.ratePeriod,
      installmentCount: Number(value.installmentCount) || 0,
    });
    return money(amount, value.currency);
  });

  protected readonly rateAdjustmentUnavailable = computed(() => {
    const value = this.formValue();
    return Boolean(
      value.adjustInterestRate &&
        value.contractedInstallmentAmount &&
        this.form.controls.contractedInstallmentAmount.valid &&
        interestRateForInstallment({
          amountBorrowed: value.amountBorrowed || '0',
          fees: value.fees || '0',
          contractedInstallmentAmount: value.contractedInstallmentAmount,
          ratePeriod: value.ratePeriod,
          installmentCount: Number(value.installmentCount) || 0,
        }) === undefined,
    );
  });

  constructor() {
    this.form.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        const value = this.form.getRawValue();
        if (value.adjustInterestRate && value.contractedInstallmentAmount) {
          const rate = interestRateForInstallment({
            amountBorrowed: value.amountBorrowed || '0',
            fees: value.fees || '0',
            contractedInstallmentAmount: value.contractedInstallmentAmount,
            ratePeriod: value.ratePeriod,
            installmentCount: Number(value.installmentCount) || 0,
          });
          if (rate !== undefined && rate !== value.interestRate) {
            this.form.controls.interestRate.setValue(rate, { emitEvent: false });
          }
        }
        this.formValue.set(this.form.getRawValue());
      });

    effect(() => {
      if (!this.open()) return;
      const loan = this.loan();
      this.form.reset({
        name: loan?.name ?? '',
        categoryId: loan?.categoryId ?? '',
        currency: loan?.currency ?? this.baseCurrency(),
        amountBorrowed: loan?.amountBorrowed ?? '',
        fees: loan?.fees ?? '0',
        interestRate: loan?.interestRate ?? '0',
        ratePeriod: loan?.ratePeriod ?? 'annual',
        installmentCount: loan?.installmentCount ?? 12,
        contractedInstallmentAmount: loan?.contractedInstallmentAmount ?? '',
        adjustInterestRate: false,
        firstPaymentDate: loan?.firstPaymentDate ?? todayIso(),
        notes: loan?.notes ?? '',
        autoPost: loan?.autoPost ?? false,
        institutionId: '',
        paymentAccountId: loan?.paymentAccountId ?? '',
      });
      this.formValue.set(this.form.getRawValue());
      this.saveErrorKey.set(null);
    });
  }

  protected submit(): void {
    const raw = this.form.getRawValue();
    if (raw.autoPost && !raw.paymentAccountId) {
      this.form.controls.paymentAccountId.setErrors({ required: true });
    }
    if (this.form.invalid || this.rateAdjustmentUnavailable()) {
      this.form.markAllAsTouched();
      return;
    }

    const existing = this.loan();
    const payload = {
      name: raw.name.trim(),
      categoryId: raw.categoryId,
      currency: raw.currency,
      amountBorrowed: raw.amountBorrowed,
      fees: raw.fees || '0',
      interestRate: raw.interestRate || '0',
      ratePeriod: raw.ratePeriod,
      installmentCount: Number(raw.installmentCount),
      contractedInstallmentAmount: raw.contractedInstallmentAmount || undefined,
      firstPaymentDate: raw.firstPaymentDate,
      notes: raw.notes.trim() || undefined,
      autoPost: raw.autoPost,
      paymentAccountId: raw.paymentAccountId || undefined,
    };

    this.saving.set(true);
    (existing
      ? this.loans.update(existing.id, payload)
      : this.loans.create({ ...payload, archived: false })
    ).subscribe({
      next: () => {
        this.saving.set(false);
        this.open.set(false);
        this.saved.emit();
      },
      error: (error: unknown) => {
        this.saving.set(false);
        const code = error instanceof ApiError ? error.code : undefined;
        this.saveErrorKey.set(
          code === 'loan.installment_count_below_paid'
            ? `errors.${code}`
            : 'loans.form.saveError',
        );
      },
    });
  }
}
