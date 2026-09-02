import { Component, computed, effect, inject, input, model, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, ValidatorFn, Validators } from '@angular/forms';
import { TranslocoDirective } from '@jsverse/transloco';
import { ManualRateRepository } from '../../data/manual-rate.repository';
import { todayIso } from '../../domain/calc/dates';
import { ManualRate } from '../../domain/models/manual-rate';
import { MetadataService } from '../../core/metadata.service';
import { decimalAmountValidator } from '../../shared/money/decimal-amount.validator';
import { money } from '../../shared/money/money';
import { convertByRate } from '../../shared/money/rate';
import { Button } from '../../shared/ui/button/button';
import { Modal } from '../../shared/ui/modal/modal';

const positiveRateValidator: ValidatorFn = (control) => {
  const value = control.value;
  return value === null || value === undefined || value === '' || Number(value) > 0
    ? null
    : { nonPositiveRate: true };
};

/**
 * Create/edit for a ManualRate - a user-defined exchange rate for one
 * currency pair, effective from a date (see domain/models/manual-rate.ts).
 * A rate is identified by (baseCode, quoteCode, asOf) - see
 * MockStore.upsertManualRate - so re-saving the same pair/date edits that
 * row rather than creating a duplicate, the same way editing here works.
 */
@Component({
  selector: 'app-manual-rate-form-modal',
  imports: [ReactiveFormsModule, TranslocoDirective, Modal, Button],
  templateUrl: './manual-rate-form-modal.html',
  styleUrl: './manual-rate-form-modal.scss',
})
export class ManualRateFormModal {
  private readonly manualRates = inject(ManualRateRepository);
  private readonly fb = inject(FormBuilder);
  private readonly metadata = inject(MetadataService);

  readonly open = model.required<boolean>();
  readonly rate = input<ManualRate | undefined>(undefined);
  /** Create-mode only - prefills the pair when opened from a specific "needs a rate" prompt (a fallback account currency or transaction). */
  readonly prefillBaseCode = input<string | undefined>(undefined);
  readonly prefillQuoteCode = input<string | undefined>(undefined);
  readonly saved = output<ManualRate>();

  protected readonly currencyOptions = computed(() =>
    this.metadata.currencies().map((row) => row.code),
  );
  protected readonly saving = signal(false);
  protected readonly saveErrorKey = signal<string | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    baseCode: ['USD', Validators.required],
    quoteCode: ['BRL', Validators.required],
    rate: ['1', [Validators.required, decimalAmountValidator(10), positiveRateValidator]],
    asOf: [todayIso(), Validators.required],
  });
  private readonly formValue = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });
  protected readonly ratePreview = computed(() => {
    const { baseCode, quoteCode, rate } = this.formValue();
    if (!baseCode || !quoteCode || baseCode === quoteCode || !rate) return null;
    try {
      const converted = convertByRate(money('1', baseCode), String(rate), quoteCode);
      return { baseCode, quoteCode, amount: converted.amount };
    } catch {
      return null;
    }
  });

  /**
   * t(exchange.manualRates.form.editTitle, exchange.manualRates.form.newTitle, exchange.manualRates.form.saveError, exchange.manualRates.form.errors.samePair)
   */
  protected readonly titleKey = computed(() =>
    this.rate() ? 'exchange.manualRates.form.editTitle' : 'exchange.manualRates.form.newTitle',
  );

  constructor() {
    effect(() => {
      if (!this.open()) return;
      const rate = this.rate();
      this.form.reset({
        baseCode: rate?.baseCode ?? this.prefillBaseCode() ?? 'USD',
        quoteCode: rate?.quoteCode ?? this.prefillQuoteCode() ?? 'BRL',
        rate: rate?.rate ?? '1',
        asOf: rate?.asOf ?? todayIso(),
      });
      this.saveErrorKey.set(null);
    });
  }

  protected submit(): void {
    const raw = this.form.getRawValue();
    const samePair = raw.baseCode === raw.quoteCode;

    if (this.form.invalid || samePair) {
      this.form.markAllAsTouched();
      this.saveErrorKey.set(
        samePair
          ? 'exchange.manualRates.form.errors.samePair'
          : 'exchange.manualRates.form.saveError',
      );
      return;
    }

    this.saving.set(true);
    this.manualRates.upsert(raw).subscribe({
      next: (rate) => {
        this.saving.set(false);
        this.open.set(false);
        this.saved.emit(rate);
      },
      error: () => {
        this.saving.set(false);
        this.saveErrorKey.set('exchange.manualRates.form.saveError');
      },
    });
  }
}
