import { Component, computed, effect, inject, input, model, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslocoDirective } from '@jsverse/transloco';
import { RecurringRuleRepository } from '../../data/recurring-rule.repository';
import { formatIsoDate } from '../../domain/calc/dates';
import { Account } from '../../domain/models/account';
import { Category } from '../../domain/models/category';
import { Institution } from '../../domain/models/institution';
import { RecurringFrequency, RecurringRule } from '../../domain/models/recurring';
import { groupAccountsByInstitution } from '../accounts/institution-grouping';
import { decimalAmountValidator } from '../../shared/money/decimal-amount.validator';
import { Button } from '../../shared/ui/button/button';
import { Modal } from '../../shared/ui/modal/modal';

const FREQUENCIES: readonly RecurringFrequency[] = ['weekly', 'monthly', 'yearly'];

/**
 * Create/edit form for a RecurringRule directly (the recurring rules tab
 * on the transactions screen). Limited to income/expense — a recurring
 * *transfer* is a real pattern in principle, but this scaffold keeps
 * recurrence to the income/expense case transaction-form-modal.ts also
 * covers, rather than doubling the surface for a less common case.
 */
@Component({
  selector: 'app-recurring-rule-form-modal',
  imports: [ReactiveFormsModule, TranslocoDirective, Modal, Button],
  templateUrl: './recurring-rule-form-modal.html',
  styleUrl: './recurring-rule-form-modal.scss'
})
export class RecurringRuleFormModal {
  private readonly recurringRules = inject(RecurringRuleRepository);
  private readonly fb = inject(FormBuilder);

  readonly open = model.required<boolean>();
  readonly rule = input<RecurringRule | undefined>(undefined);
  readonly accounts = input.required<Account[]>();
  readonly categories = input.required<Category[]>();
  readonly institutions = input<Institution[]>([]);
  readonly saved = output<void>();

  protected readonly frequencies = FREQUENCIES;
  protected readonly saving = signal(false);
  protected readonly saveErrorKey = signal<string | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    type: ['expense' as 'income' | 'expense', Validators.required],
    frequency: ['monthly' as RecurringFrequency, Validators.required],
    interval: [1, [Validators.required, Validators.min(1)]],
    startDate: [formatIsoDate(new Date()), Validators.required],
    endDate: [''],
    amount: ['', [Validators.required, decimalAmountValidator()]],
    accountId: ['', Validators.required],
    categoryId: ['', Validators.required],
    description: ['', Validators.required]
  });

  private readonly selectedType = toSignal(this.form.controls.type.valueChanges, {
    initialValue: this.form.controls.type.value
  });
  protected readonly categoryOptions = computed(() =>
    this.categories().filter((category) => !category.archived && category.kind === this.selectedType())
  );
  /** <optgroup>-per-institution for the account select (display-only — no transfer support here). */
  protected readonly accountGroups = computed(() =>
    groupAccountsByInstitution(this.accounts(), this.institutions())
  );
  /**
   * titleKey/saveErrorKey hold these as plain string literals, only ever
   * passed to the marker function from the template — see
   * account-form-modal.ts / layout/sidebar.ts for why that needs this
   * JSDoc "dynamic markings" block:
   * t(transactions.recurring.form.editTitle, transactions.recurring.form.newTitle, transactions.recurring.form.saveError)
   */
  protected readonly titleKey = computed(() =>
    this.rule() ? 'transactions.recurring.form.editTitle' : 'transactions.recurring.form.newTitle'
  );

  constructor() {
    effect(() => {
      if (!this.open()) return;
      const rule = this.rule();
      this.form.reset({
        type: (rule?.template.type as 'income' | 'expense') ?? 'expense',
        frequency: rule?.frequency ?? 'monthly',
        interval: rule?.interval ?? 1,
        startDate: rule?.startDate ?? formatIsoDate(new Date()),
        endDate: rule?.endDate ?? '',
        amount: rule?.template.amount ?? '',
        accountId: rule?.template.accountId ?? '',
        categoryId: rule?.template.categoryId ?? '',
        description: rule?.template.description ?? ''
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
    const account = this.accounts().find((a) => a.id === raw.accountId);
    if (!account) return;

    const payload: Omit<RecurringRule, 'id'> = {
      frequency: raw.frequency,
      interval: raw.interval,
      startDate: raw.startDate,
      endDate: raw.endDate || undefined,
      template: {
        type: raw.type,
        amount: raw.amount,
        currency: account.currency,
        accountId: raw.accountId,
        categoryId: raw.categoryId,
        description: raw.description.trim()
      }
    };

    this.saving.set(true);
    const existing = this.rule();
    const request$ = existing
      ? this.recurringRules.update(existing.id, payload)
      : this.recurringRules.create(payload);

    request$.subscribe({
      next: () => {
        this.saving.set(false);
        this.open.set(false);
        this.saved.emit();
      },
      error: () => {
        this.saving.set(false);
        this.saveErrorKey.set('transactions.recurring.form.saveError');
      }
    });
  }
}
