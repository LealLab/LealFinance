import { Component, computed, effect, inject, input, model, output, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslocoDirective } from '@jsverse/transloco';
import { switchMap } from 'rxjs';
import { AccountRepository } from '../../data/account.repository';
import { GoalRepository } from '../../data/goal.repository';
import { InstitutionRepository } from '../../data/institution.repository';
import { Account } from '../../domain/models/account';
import { Goal } from '../../domain/models/goal';
import { RecurringFrequency } from '../../domain/models/recurring';
import { decimalAmountValidator } from '../../shared/money/decimal-amount.validator';
import { CURRENCY_OPTIONS } from '../../shared/currency-options';
import { Button } from '../../shared/ui/button/button';
import { Modal } from '../../shared/ui/modal/modal';

const FREQUENCIES: readonly RecurringFrequency[] = ['weekly', 'monthly', 'yearly'];
const GOALS_INSTITUTION_ID = 'inst-goals';

/** t(goals.form.newTitle, goals.form.editTitle, goals.form.saveError) */

@Component({
  selector: 'app-goal-form-modal',
  imports: [ReactiveFormsModule, TranslocoDirective, Button, Modal],
  templateUrl: './goal-form-modal.html',
  styleUrl: './goal-form-modal.scss',
})
export class GoalFormModal {
  private readonly accounts = inject(AccountRepository);
  private readonly goals = inject(GoalRepository);
  private readonly institutions = inject(InstitutionRepository);
  private readonly fb = inject(FormBuilder);

  readonly open = model.required<boolean>();
  readonly goal = input<Goal | undefined>(undefined);
  readonly accountsById = input.required<Map<string, Account>>();
  readonly saved = output<Goal>();

  protected readonly currencyOptions = CURRENCY_OPTIONS;
  protected readonly frequencies = FREQUENCIES;
  protected readonly saving = signal(false);
  protected readonly saveErrorKey = signal<string | null>(null);
  protected readonly institutionsResource = rxResource({ stream: () => this.institutions.list() });
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
    const existingAccount = existing ? this.accountsById().get(existing.accountId) : undefined;
    const institution = this.institutionsResource
      .value()
      ?.find((entry) => entry.id === GOALS_INSTITUTION_ID);
    const accountInput: Omit<Account, 'id'> = {
      name: raw.name.trim(),
      type: 'goal',
      currency: raw.currency,
      openingBalance: existingAccount?.openingBalance ?? '0',
      institutionId: institution?.id,
      archived: existingAccount?.archived ?? false,
    };
    const ensureInstitution$ = institution
      ? this.accounts.create(accountInput)
      : this.institutions
          .create({ name: 'Metas', icon: 'piggy', color: '#D89B3D', archived: false, position: 99 })
          .pipe(
            switchMap((created) =>
              this.accounts.create({ ...accountInput, institutionId: created.id }),
            ),
          );
    const account$ = existingAccount
      ? this.accounts.update(existingAccount.id, {
          name: accountInput.name,
          currency: accountInput.currency,
        })
      : ensureInstitution$;

    this.saving.set(true);
    account$
      .pipe(
        switchMap((account) => {
          const payload: Omit<Goal, 'id'> = {
            accountId: account.id,
            name: raw.name.trim(),
            targetAmount: raw.targetAmount,
            currency: raw.currency,
            targetDate: raw.targetDate || undefined,
            frequency: raw.targetDate ? raw.frequency || undefined : undefined,
            interval: raw.targetDate && raw.frequency ? raw.interval : undefined,
            archived: existing?.archived ?? false,
          };
          return existing ? this.goals.update(existing.id, payload) : this.goals.create(payload);
        }),
      )
      .subscribe({
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
