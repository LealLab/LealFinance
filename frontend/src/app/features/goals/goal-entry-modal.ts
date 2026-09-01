import { Component, computed, effect, inject, input, model, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslocoDirective } from '@jsverse/transloco';
import { TransactionRepository } from '../../data/transaction.repository';
import { todayIso } from '../../domain/calc/dates';
import { Account } from '../../domain/models/account';
import { Goal } from '../../domain/models/goal';
import { Transaction } from '../../domain/models/transaction';
import { decimalAmountValidator } from '../../shared/money/decimal-amount.validator';
import { Button } from '../../shared/ui/button/button';
import { Modal } from '../../shared/ui/modal/modal';

export type GoalEntryMode = 'deposit' | 'withdraw' | 'interest';

/** t(goals.entries.deposit.title, goals.entries.withdraw.title, goals.entries.interest.title, goals.entries.saveError) */

@Component({
  selector: 'app-goal-entry-modal',
  imports: [ReactiveFormsModule, TranslocoDirective, Button, Modal],
  templateUrl: './goal-entry-modal.html',
  styleUrl: './goal-entry-modal.scss',
})
export class GoalEntryModal {
  private readonly transactions = inject(TransactionRepository);
  private readonly fb = inject(FormBuilder);

  readonly open = model.required<boolean>();
  readonly mode = input.required<GoalEntryMode>();
  readonly goal = input.required<Goal>();
  readonly goalAccount = input.required<Account>();
  readonly accounts = input.required<Account[]>();
  readonly saved = output<void>();

  protected readonly saving = signal(false);
  protected readonly saveErrorKey = signal<string | null>(null);
  protected readonly titleKey = computed(() => `goals.entries.${this.mode()}.title`);
  protected readonly sourceAccounts = computed(() =>
    this.accounts().filter(
      (account) =>
        !account.archived &&
        account.id !== this.goalAccount().id &&
        account.type !== 'goal' &&
        account.currency === this.goalAccount().currency,
    ),
  );

  protected readonly form = this.fb.nonNullable.group({
    amount: ['', [Validators.required, decimalAmountValidator()]],
    date: [todayIso(), Validators.required],
    sourceAccountId: ['', Validators.required],
    description: ['', Validators.required],
  });

  protected readonly isInterest = computed(() => this.mode() === 'interest');

  constructor() {
    effect(() => {
      if (!this.open()) return;
      const mode = this.mode();
      this.form.reset({
        amount: '',
        date: todayIso(),
        sourceAccountId: this.sourceAccounts()[0]?.id ?? '',
        description:
          mode === 'interest'
            ? 'Rendimento da meta'
            : mode === 'deposit'
              ? 'Aporte na meta'
              : 'Resgate da meta',
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
    const goalAccount = this.goalAccount();
    let payload: Omit<Transaction, 'id'>;
    if (this.isInterest()) {
      payload = {
        type: 'interest',
        date: raw.date,
        amount: raw.amount,
        currency: goalAccount.currency,
        accountId: goalAccount.id,
        description: raw.description.trim(),
      };
    } else {
      const sourceAccount = this.sourceAccounts().find(
        (account) => account.id === raw.sourceAccountId,
      );
      if (!sourceAccount) return;
      payload = {
        type: 'transfer',
        date: raw.date,
        amount: raw.amount,
        currency: sourceAccount.currency,
        accountId: this.mode() === 'deposit' ? sourceAccount.id : goalAccount.id,
        toAccountId: this.mode() === 'deposit' ? goalAccount.id : sourceAccount.id,
        description: raw.description.trim(),
      };
    }
    this.saving.set(true);
    this.transactions.create(payload).subscribe({
      next: () => {
        this.saving.set(false);
        this.open.set(false);
        this.saved.emit();
      },
      error: () => {
        this.saving.set(false);
        this.saveErrorKey.set('goals.entries.saveError');
      },
    });
  }
}
