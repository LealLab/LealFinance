import { Component, computed, effect, inject, input, model, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslocoDirective } from '@jsverse/transloco';
import { RecurringRuleRepository } from '../../data/recurring-rule.repository';
import { TransactionRepository } from '../../data/transaction.repository';
import { formatIsoDate } from '../../domain/calc/dates';
import { Account } from '../../domain/models/account';
import { Category } from '../../domain/models/category';
import { RecurringFrequency } from '../../domain/models/recurring';
import { Transaction, TransactionType } from '../../domain/models/transaction';
import { decimalAmountValidator } from '../../shared/money/decimal-amount.validator';
import { Button } from '../../shared/ui/button/button';
import { Modal } from '../../shared/ui/modal/modal';

const TRANSACTION_TYPES: readonly TransactionType[] = ['expense', 'income', 'transfer'];
const FREQUENCIES: readonly RecurringFrequency[] = ['weekly', 'monthly', 'yearly'];

/**
 * Create/edit form for a Transaction — income/expense/transfer share one
 * modal with a segmented type control that swaps which fields apply (see
 * transaction-form-modal.html). Creating with "repeat" checked also
 * creates a RecurringRule from the same fields (edit doesn't offer this —
 * promoting an *existing* transaction into a rule after the fact is a
 * separate, more involved flow this scaffold doesn't cover).
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
  readonly saved = output<void>();

  protected readonly transactionTypes = TRANSACTION_TYPES;
  protected readonly frequencies = FREQUENCIES;
  protected readonly saving = signal(false);
  protected readonly saveErrorKey = signal<string | null>(null);

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
    interval: [1, [Validators.min(1)]]
  });

  private readonly selectedType = toSignal(this.form.controls.type.valueChanges, {
    initialValue: this.form.controls.type.value
  });
  protected readonly isTransfer = computed(() => this.selectedType() === 'transfer');

  protected readonly categoryOptions = computed(() => {
    const kind = this.isTransfer() ? undefined : this.selectedType() === 'income' ? 'income' : 'expense';
    return this.categories().filter((category) => !category.archived && category.kind === kind);
  });

  /**
   * titleKey/saveErrorKey hold these as plain string literals, only ever
   * passed to the marker function from the template — see
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
        interval: 1
      });
      this.saveErrorKey.set(null);
    });
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
