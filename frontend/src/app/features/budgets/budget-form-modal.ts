import { Component, computed, effect, inject, input, model, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslocoDirective } from '@jsverse/transloco';
import { BudgetRepository } from '../../data/budget.repository';
import { Budget } from '../../domain/models/budget';
import { Category } from '../../domain/models/category';
import { CURRENCY_OPTIONS } from '../../shared/currency-options';
import { decimalAmountValidator } from '../../shared/money/decimal-amount.validator';
import { Button } from '../../shared/ui/button/button';
import { Modal } from '../../shared/ui/modal/modal';

/**
 * Create/edit for a Budget (a category's spending limit for one month).
 * The month is always the one currently selected on the budgets screen -
 * never an editable field here - so "new budget" always means "for the
 * month I'm looking at," and editing only ever touches the amount.
 */
@Component({
  selector: 'app-budget-form-modal',
  imports: [ReactiveFormsModule, TranslocoDirective, Modal, Button],
  templateUrl: './budget-form-modal.html',
  styleUrl: './budget-form-modal.scss'
})
export class BudgetFormModal {
  private readonly budgets = inject(BudgetRepository);
  private readonly fb = inject(FormBuilder);

  readonly open = model.required<boolean>();
  readonly budget = input<Budget | undefined>(undefined);
  readonly prefillCategoryId = input<string | undefined>(undefined);
  readonly month = input.required<string>();
  /** Top-level expense categories not yet budgeted for `month` - the create-mode picker. */
  readonly availableCategories = input.required<Category[]>();
  /** Every category, for resolving the (read-only, non-editable) category name in edit mode. */
  readonly allCategories = input.required<Category[]>();
  readonly saved = output<Budget>();

  protected readonly currencyOptions = CURRENCY_OPTIONS;
  protected readonly saving = signal(false);
  protected readonly saveErrorKey = signal<string | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    categoryId: ['', Validators.required],
    amount: ['', [Validators.required, decimalAmountValidator()]],
    currency: ['BRL', Validators.required]
  });

  protected readonly isEditing = computed(() => this.budget() !== undefined);
  protected readonly editingCategoryName = computed(() => {
    const budget = this.budget();
    if (!budget) return '';
    return this.allCategories().find((c) => c.id === budget.categoryId)?.name ?? '';
  });

  /**
   * t(budgets.form.editTitle, budgets.form.newTitle, budgets.form.saveError)
   */
  protected readonly titleKey = computed(() =>
    this.budget() ? 'budgets.form.editTitle' : 'budgets.form.newTitle'
  );

  constructor() {
    effect(() => {
      if (!this.open()) return;
      const budget = this.budget();
      this.form.reset({
        categoryId: budget?.categoryId ?? this.prefillCategoryId() ?? '',
        amount: budget?.amount ?? '',
        currency: budget?.currency ?? 'BRL'
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
    const payload: Omit<Budget, 'id'> = {
      categoryId: raw.categoryId,
      month: this.month(),
      amount: raw.amount,
      currency: raw.currency
    };

    this.saving.set(true);
    this.budgets.upsert(payload).subscribe({
      next: (budget) => {
        this.saving.set(false);
        this.open.set(false);
        this.saved.emit(budget);
      },
      error: () => {
        this.saving.set(false);
        this.saveErrorKey.set('budgets.form.saveError');
      }
    });
  }
}
