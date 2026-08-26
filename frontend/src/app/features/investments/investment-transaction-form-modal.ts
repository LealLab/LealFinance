import { Component, computed, effect, inject, input, model, output, signal } from '@angular/core';
import { rxResource, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslocoDirective } from '@jsverse/transloco';
import { InvestmentTransactionRepository } from '../../data/investment-transaction.repository';
import { InvestmentWalletRepository } from '../../data/investment-wallet.repository';
import { formatIsoDate } from '../../domain/calc/dates';
import {
  InvestmentAsset,
  InvestmentTransaction,
  InvestmentTransactionType,
} from '../../domain/models/investment';
import { decimalAmountValidator } from '../../shared/money/decimal-amount.validator';
import { money, Money, multiply } from '../../shared/money/money';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { Button } from '../../shared/ui/button/button';
import { Modal } from '../../shared/ui/modal/modal';

const TRANSACTION_TYPES: readonly InvestmentTransactionType[] = ['buy', 'sell', 'dividend', 'fee'];

/** t(investments.transactions.form.newTitle, investments.transactions.form.editTitle, investments.transactions.form.saveError, investments.transactions.form.errors.invalid) */

@Component({
  selector: 'app-investment-transaction-form-modal',
  imports: [ReactiveFormsModule, TranslocoDirective, Button, Modal, MoneyPipe],
  templateUrl: './investment-transaction-form-modal.html',
  styleUrl: './investment-transaction-form-modal.scss',
})
export class InvestmentTransactionFormModal {
  private readonly transactions = inject(InvestmentTransactionRepository);
  private readonly wallets = inject(InvestmentWalletRepository);
  private readonly fb = inject(FormBuilder);

  readonly open = model.required<boolean>();
  readonly walletId = input.required<string>();
  readonly transaction = input<InvestmentTransaction | undefined>(undefined);
  readonly assets = input.required<InvestmentAsset[]>();
  readonly saved = output<InvestmentTransaction>();

  protected readonly transactionTypes = TRANSACTION_TYPES;
  protected readonly walletResource = rxResource({
    stream: () => this.wallets.get(this.walletId()),
  });
  protected readonly saving = signal(false);
  protected readonly saveErrorKey = signal<string | null>(null);
  protected readonly isEditing = computed(() => this.transaction() !== undefined);
  protected readonly titleKey = computed(() =>
    this.transaction()
      ? 'investments.transactions.form.editTitle'
      : 'investments.transactions.form.newTitle',
  );
  protected readonly form = this.fb.nonNullable.group({
    type: ['buy' as InvestmentTransactionType, Validators.required],
    assetId: [''],
    date: [formatIsoDate(new Date()), Validators.required],
    quantity: ['', decimalAmountValidator(10)],
    price: ['', decimalAmountValidator(10)],
    amount: ['', decimalAmountValidator()],
    fee: ['', decimalAmountValidator()],
    currency: [{ value: '', disabled: true }, Validators.required],
    notes: [''],
  });

  private readonly quantityValue = toSignal(this.form.controls.quantity.valueChanges, {
    initialValue: this.form.controls.quantity.value,
  });
  private readonly priceValue = toSignal(this.form.controls.price.valueChanges, {
    initialValue: this.form.controls.price.value,
  });
  private readonly selectedType = toSignal(this.form.controls.type.valueChanges, {
    initialValue: this.form.controls.type.value,
  });
  protected readonly isTrade = computed(() => this.selectedType() === 'buy' || this.selectedType() === 'sell');
  protected readonly needsAsset = computed(() => this.selectedType() !== 'fee');
  protected readonly isAmountEntry = computed(
    () => this.selectedType() === 'dividend' || this.selectedType() === 'fee',
  );
  protected readonly currency = computed(
    () => this.walletResource.value()?.currency ?? this.transaction()?.currency ?? 'USD',
  );
  protected readonly quantityTimesPrice = computed<Money | null>(() => {
    const quantity = this.quantityValue();
    const price = this.priceValue();
    if (!quantity || !price) return null;
    try {
      return multiply(money(quantity, this.currency()), price, this.currency());
    } catch {
      return null;
    }
  });

  private applyingReset = false;

  constructor() {
    effect(() => {
      if (!this.open()) return;
      const transaction = this.transaction();
      this.applyingReset = true;
      this.form.reset({
        type: transaction?.type ?? 'buy',
        assetId: transaction?.assetId ?? '',
        date: transaction?.date ?? formatIsoDate(new Date()),
        quantity: transaction?.quantity ?? '',
        price: transaction?.price ?? '',
        amount: transaction?.amount ?? '',
        fee: transaction?.fee ?? '',
        currency: transaction?.currency ?? this.currency(),
        notes: transaction?.notes ?? '',
      });
      this.applyingReset = false;
      this.saveErrorKey.set(null);
    });

    this.form.controls.type.valueChanges.subscribe((type) => {
      if (this.applyingReset) return;
      if (type === 'fee') {
        this.form.controls.assetId.setValue('');
        this.form.controls.quantity.setValue('');
        this.form.controls.price.setValue('');
      } else if (type === 'dividend') {
        this.form.controls.quantity.setValue('');
        this.form.controls.price.setValue('');
      }
    });
  }

  protected submit(): void {
    const raw = this.form.getRawValue();
    const trade = raw.type === 'buy' || raw.type === 'sell';
    const amountEntry = raw.type === 'dividend' || raw.type === 'fee';
    const valid =
      this.form.controls.type.valid &&
      this.form.controls.date.valid &&
      this.form.controls.fee.valid &&
      this.form.controls.currency.valid &&
      (!this.needsAsset() || Boolean(raw.assetId)) &&
      (!trade || (Boolean(raw.quantity) && Boolean(raw.price) && this.form.controls.quantity.valid && this.form.controls.price.valid)) &&
      (!amountEntry || (Boolean(raw.amount) && this.form.controls.amount.valid));
    const preview = this.quantityTimesPrice();
    if (!valid || (trade && !preview)) {
      this.form.markAllAsTouched();
      this.saveErrorKey.set('investments.transactions.form.errors.invalid');
      return;
    }

    const payload = {
      walletId: this.walletId(),
      assetId: this.needsAsset() ? raw.assetId || undefined : undefined,
      type: raw.type,
      date: raw.date,
      quantity: trade ? raw.quantity || undefined : undefined,
      price: trade ? raw.price || undefined : undefined,
      amount: trade ? preview!.amount : raw.amount,
      fee: raw.fee || '0',
      currency: this.currency(),
      notes: raw.notes.trim() || undefined,
    } satisfies Omit<InvestmentTransaction, 'id' | 'transactionId'>;

    this.saving.set(true);
    const existing = this.transaction();
    (existing
      ? this.transactions.update(existing.id, payload)
      : this.transactions.create(payload)
    ).subscribe({
      next: (saved) => {
        this.saving.set(false);
        this.open.set(false);
        this.saved.emit(saved);
      },
      error: () => {
        this.saving.set(false);
        this.saveErrorKey.set('investments.transactions.form.saveError');
      },
    });
  }
}
