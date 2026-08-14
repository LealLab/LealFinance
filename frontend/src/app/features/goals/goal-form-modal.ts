import { Component, computed, effect, inject, input, model, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslocoDirective } from '@jsverse/transloco';
import { MetadataService } from '../../core/metadata.service';
import { GoalRepository } from '../../data/goal.repository';
import { Goal } from '../../domain/models/goal';
import { RecurringFrequency } from '../../domain/models/recurring';
import { decimalAmountValidator } from '../../shared/money/decimal-amount.validator';
import { Button } from '../../shared/ui/button/button';
import { Modal } from '../../shared/ui/modal/modal';

const FREQUENCIES: readonly RecurringFrequency[] = ['weekly', 'monthly', 'yearly'];

/** t(goals.form.newTitle, goals.form.editTitle, goals.form.saveError) */

@Component({
  selector: 'app-goal-form-modal',
  imports: [ReactiveFormsModule, TranslocoDirective, Button, Modal],
  templateUrl: './goal-form-modal.html',
  styleUrl: './goal-form-modal.scss',
})
export class GoalFormModal {
  private readonly goals = inject(GoalRepository);
  private readonly metadata = inject(MetadataService);
  private readonly fb = inject(FormBuilder);

  readonly open = model.required<boolean>();
  readonly goal = input<Goal | undefined>(undefined);
  readonly saved = output<Goal>();

  protected readonly currencyOptions = computed(() =>
    this.metadata.currencies().map((row) => row.code),
  );
  protected readonly frequencies = FREQUENCIES;
  protected readonly saving = signal(false);
  protected readonly saveErrorKey = signal<string | null>(null);
  protected readonly isEditing = computed(() => this.goal() !== undefined);
  protected readonly titleKey = computed(() =>
    this.goal() ? 'goals.form.editTitle' : 'goals.form.newTitle',
  );

  protected readonly form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    targetAmount: ['', [Validators.required, decimalAmountValidator()]],
    currency: ['BRL', Validators.required],
    targetDate: [''],
    frequency: ['monthly' as RecurringFrequency | ''],
    interval: [1, [Validators.min(1)]],
  });

  constructor() {
    effect(() => {
      if (!this.open()) return;
      const goal = this.goal();
      this.form.reset({
        name: goal?.name ?? '',
        targetAmount: goal?.targetAmount ?? '',
        currency: goal?.currency ?? 'BRL',
        targetDate: goal?.targetDate ?? '',
        frequency: goal?.frequency ?? 'monthly',
        interval: goal?.interval ?? 1,
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
    const existing = this.goal();
    const payload = {
      name: raw.name.trim(),
      targetAmount: raw.targetAmount,
      currency: raw.currency,
      targetDate: raw.targetDate || undefined,
      frequency: raw.targetDate ? raw.frequency || undefined : undefined,
      interval: raw.targetDate && raw.frequency ? raw.interval : undefined,
    };

    this.saving.set(true);
    (existing
      ? this.goals.update(existing.id, payload)
      : this.goals.create({ ...payload, archived: false })
    ).subscribe({
      next: (goal) => {
        this.saving.set(false);
        this.open.set(false);
        this.saved.emit(goal);
      },
      error: () => {
        this.saving.set(false);
        this.saveErrorKey.set('goals.form.saveError');
      },
    });
  }
}
