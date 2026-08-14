import { Component, computed, effect, inject, input, model, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslocoDirective } from '@jsverse/transloco';
import { RecurringRuleRepository } from '../../data/recurring-rule.repository';
import { TransactionRepository } from '../../data/transaction.repository';
import { formatIsoDate } from '../../domain/calc/dates';
import { Account } from '../../domain/models/account';
import { Category } from '../../domain/models/category';
import { Institution } from '../../domain/models/institution';
import { RecurringFrequency } from '../../domain/models/recurring';
import { Transaction, TransactionType } from '../../domain/models/transaction';
import { groupAccountsByInstitution } from '../accounts/institution-grouping';
import { decimalAmountValidator } from '../../shared/money/decimal-amount.validator';
import { Button } from '../../shared/ui/button/button';
import { Modal } from '../../shared/ui/modal/modal';

const TRANSACTION_TYPES: readonly TransactionType[] = ['expense', 'income', 'transfer'];
const FREQUENCIES: readonly RecurringFrequency[] = ['weekly', 'monthly', 'yearly'];

/**
 * Create/edit form for a Transaction - income/expense/transfer share one
 * modal with a segmented type control that swaps which fields apply (see
 * transaction-form-modal.html). Creating with "repeat" checked also
 * creates a RecurringRule from the same fields (edit doesn't offer this -
 * promoting an *existing* transaction into a rule after the fact is a
 * separate, more involved flow this scaffold doesn't cover).
 *
 * `fromInstitutionId`/`toInstitutionId` are transfer-only, UI-only filter
 * controls - they narrow which accounts the two transfer selects offer,
 * but are never part of the payload sent to TransactionRepository
 * (Transaction itself has no institution fields; a transfer's institutions
 * are implied by its two accounts). `toInstitutionId` defaults to the
 * source account's own institution whenever the source account changes,
 * so a same-institution transfer needs no extra clicks - see the
 * `accountId.valueChanges` subscription below.
 */
@Component({
  selector: 'app-transaction-form-modal',
  imports: [ReactiveFormsModule, TranslocoDirective, Modal, Button],
  templateUrl: './transaction-form-modal.html',
  styleUrl: './transaction-form-modal.scss'
})
export class TransactionFormModal {
  private readonly transactions = inject(TransactionRepository);
  private readonly recurringRules = inject(RecurringRuleRepository);
  private readonly fb = inject(FormBuilder);

  readonly open = model.required<boolean>();
  readonly transaction = input<Transaction | undefined>(undefined);
  readonly accounts = input.required<Account[]>();
  readonly categories = input.required<Category[]>();
  readonly institutions = input<Institution[]>([]);
  readonly saved = output<void>();

  protected readonly transactionTypes = TRANSACTION_TYPES;
  protected readonly frequencies = FREQUENCIES;
  protected readonly saving = signal(false);
  protected readonly saveErrorKey = signal<string | null>(null);

  /** True while the constructor effect is repopulating the form on open - see the note above `clearAccountIfMismatched`. */
  private applyingReset = false;

  protected readonly form = this.fb.nonNullable.group({
    type: ['expense' as TransactionType, Validators.required],
    date: [formatIsoDate(new Date()), Validators.required],
    amount: ['', [Validators.required, decimalAmountValidator()]],
    accountId: ['', Validators.required],
    toAccountId: [''],
    categoryId: [''],
    description: ['', Validators.required],
    notes: [''],
    repeat: [false],
    frequency: ['monthly' as RecurringFrequency],
    interval: [1, [Validators.min(1)]],
    fromInstitutionId: [''],
    toInstitutionId: ['']
  });

  private readonly selectedType = toSignal(this.form.controls.type.valueChanges, {
    initialValue: this.form.controls.type.value
  });
  protected readonly isTransfer = computed(() => this.selectedType() === 'transfer');

  protected readonly categoryOptions = computed(() => {
    const kind = this.isTransfer() ? undefined : this.selectedType() === 'income' ? 'income' : 'expense';
    return this.categories().filter((category) => !category.archived && category.kind === kind);
  });

  /** <optgroup>-per-institution for the plain (non-transfer) account select. */
  protected readonly accountGroups = computed(() =>
    groupAccountsByInstitution(this.accounts(), this.institutions())
  );

  private readonly selectedFromInstitutionId = toSignal(this.form.controls.fromInstitutionId.valueChanges, {
    initialValue: this.form.controls.fromInstitutionId.value
  });
  private readonly selectedToInstitutionId = toSignal(this.form.controls.toInstitutionId.valueChanges, {
    initialValue: this.form.controls.toInstitutionId.value
  });

  protected readonly fromAccountOptions = computed(() => {
    const institutionId = this.selectedFromInstitutionId();
    const accounts = this.accounts();
    return institutionId ? accounts.filter((account) => account.institutionId === institutionId) : accounts;
  });
  protected readonly toAccountOptions = computed(() => {
    const institutionId = this.selectedToInstitutionId();
    const accounts = this.accounts();
    return institutionId ? accounts.filter((account) => account.institutionId === institutionId) : accounts;
  });

  /**
   * titleKey/saveErrorKey hold these as plain string literals, only ever
   * passed to the marker function from the template - see
   * account-form-modal.ts / layout/sidebar.ts for why that needs this
   * JSDoc "dynamic markings" block:
   * t(transactions.form.editTitle, transactions.form.newTitle, transactions.form.saveError, transactions.form.errors.invalid)
   */
  protected readonly titleKey = computed(() =>
    this.transaction() ? 'transactions.form.editTitle' : 'transactions.form.newTitle'
  );

  constructor() {
    effect(() => {
      if (!this.open()) return;
      const tx = this.transaction();
      const accounts = this.accounts();
      const fromAccount = accounts.find((account) => account.id === tx?.accountId);
      const toAccount = accounts.find((account) => account.id === tx?.toAccountId);

      // Guarded so the sync subscriptions below don't treat this
      // programmatic repopulation as a user edit and clear the very
      // selections it just set (e.g. a cross-institution transfer being
      // edited would otherwise lose its toAccountId the instant the modal
      // opens).
      this.applyingReset = true;
      this.form.reset({
        type: tx?.type ?? 'expense',
        date: tx?.date ?? formatIsoDate(new Date()),
        amount: tx?.amount ?? '',
        accountId: tx?.accountId ?? '',
        toAccountId: tx?.toAccountId ?? '',
        categoryId: tx?.categoryId ?? '',
        description: tx?.description ?? '',
        notes: tx?.notes ?? '',
        repeat: false,
        frequency: 'monthly',
        interval: 1,
        fromInstitutionId: fromAccount?.institutionId ?? '',
        toInstitutionId: toAccount?.institutionId ?? ''
      });
      this.applyingReset = false;
      this.saveErrorKey.set(null);
    });

    // Defaulting toInstitutionId to the source account's own institution
    // whenever the source account changes - see the class-level doc
    // comment for why, and clearAccountIfMismatched for the symmetric
    // "narrowing a filter drops a now-invalid selection" behavior.
    this.form.controls.accountId.valueChanges.subscribe((accountId) => {
      if (this.applyingReset || this.form.controls.type.value !== 'transfer') return;
      const account = this.accounts().find((a) => a.id === accountId);
      this.form.controls.toInstitutionId.setValue(account?.institutionId ?? '');
    });

    this.form.controls.fromInstitutionId.valueChanges.subscribe((institutionId) => {
      if (this.applyingReset) return;
      this.clearAccountIfMismatched('accountId', institutionId);
    });
    this.form.controls.toInstitutionId.valueChanges.subscribe((institutionId) => {
      if (this.applyingReset) return;
      this.clearAccountIfMismatched('toAccountId', institutionId);
    });
  }

  /**
   * Narrowing an institution filter (fromInstitutionId/toInstitutionId) to
   * something specific drops the currently-selected account on that side
   * if it no longer belongs to that institution - rather than silently
   * keeping a selection the filtered <select> no longer even lists.
   */
  private clearAccountIfMismatched(controlName: 'accountId' | 'toAccountId', institutionId: string): void {
    if (!institutionId) return;
    const control = this.form.controls[controlName];
    const account = this.accounts().find((a) => a.id === control.value);
    if (account && account.institutionId !== institutionId) {
      control.setValue('');
    }
  }

  protected submit(): void {
    const raw = this.form.getRawValue();
    const isTransfer = raw.type === 'transfer';

    if (
      this.form.controls.type.invalid ||
      this.form.controls.date.invalid ||
      this.form.controls.amount.invalid ||
      this.form.controls.accountId.invalid ||
      this.form.controls.description.invalid ||
      (isTransfer && (!raw.toAccountId || raw.toAccountId === raw.accountId)) ||
      (!isTransfer && !raw.categoryId)
    ) {
      this.form.markAllAsTouched();
      this.saveErrorKey.set('transactions.form.errors.invalid');
      return;
    }

    const account = this.accounts().find((a) => a.id === raw.accountId);
    if (!account) return;

    const basePayload: Omit<Transaction, 'id'> = {
      type: raw.type,
      date: raw.date,
      amount: raw.amount,
      currency: account.currency,
      accountId: raw.accountId,
      toAccountId: isTransfer ? raw.toAccountId : undefined,
      categoryId: isTransfer ? undefined : raw.categoryId,
      description: raw.description.trim(),
      notes: raw.notes.trim() || undefined
    };

    this.saving.set(true);
    const existing = this.transaction();

    if (existing) {
      this.transactions.update(existing.id, basePayload).subscribe({
        next: () => this.onSaveSuccess(),
        error: () => this.onSaveError()
      });
      return;
    }

    if (raw.repeat && !isTransfer) {
      this.recurringRules
        .create({
          frequency: raw.frequency,
          interval: raw.interval,
          startDate: raw.date,
          template: {
            type: basePayload.type,
            amount: basePayload.amount,
            currency: basePayload.currency,
            accountId: basePayload.accountId,
            categoryId: basePayload.categoryId,
            description: basePayload.description,
            notes: basePayload.notes
          }
        })
        .subscribe({
          next: (rule) => {
            this.transactions
              .create({ ...basePayload, recurringRuleId: rule.id })
              .subscribe({ next: () => this.onSaveSuccess(), error: () => this.onSaveError() });
          },
          error: () => this.onSaveError()
        });
      return;
    }

    this.transactions.create(basePayload).subscribe({
      next: () => this.onSaveSuccess(),
      error: () => this.onSaveError()
    });
  }

  private onSaveSuccess(): void {
    this.saving.set(false);
    this.open.set(false);
    this.saved.emit();
  }

  private onSaveError(): void {
    this.saving.set(false);
    this.saveErrorKey.set('transactions.form.saveError');
  }
}
