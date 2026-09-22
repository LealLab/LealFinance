import { Component, computed, effect, inject, input, model, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslocoDirective } from '@jsverse/transloco';
import { ApiError } from '../../core/api-error';
import { PreferenceService } from '../../core/preference.service';
import {
  InvestmentAssetCreate,
  InvestmentAssetRepository,
} from '../../data/investment-asset.repository';
import {
  InvestmentAsset,
  InvestmentAssetClass,
  InvestmentQuoteProvider,
} from '../../domain/models/investment';
import { decimalAmountValidator } from '../../shared/money/decimal-amount.validator';
import { Button } from '../../shared/ui/button/button';
import { CurrencySelect } from '../../shared/ui/currency-select/currency-select';
import { Modal } from '../../shared/ui/modal/modal';

const ASSET_CLASSES: readonly InvestmentAssetClass[] = ['stock', 'etf', 'fund', 'crypto', 'bond', 'other'];
const QUOTE_PROVIDERS: readonly InvestmentQuoteProvider[] = ['twelve_data', 'brapi', 'coingecko', 'manual'];

/** t(investments.assets.form.newTitle, investments.assets.form.editTitle, investments.assets.form.saveError) */

@Component({
  selector: 'app-investment-asset-form-modal',
  imports: [ReactiveFormsModule, TranslocoDirective, Button, CurrencySelect, Modal],
  templateUrl: './investment-asset-form-modal.html',
})
export class InvestmentAssetFormModal {
  private readonly assets = inject(InvestmentAssetRepository);
  private readonly preferences = inject(PreferenceService);
  private readonly fb = inject(FormBuilder);

  readonly open = model.required<boolean>();
  readonly asset = input<InvestmentAsset | undefined>(undefined);
  readonly walletCurrency = input<string | undefined>(undefined);
  readonly saved = output<InvestmentAsset>();

  protected readonly assetClasses = ASSET_CLASSES;
  protected readonly quoteProviders = QUOTE_PROVIDERS;
  private readonly baseCurrency = computed(
    () => this.preferences.preferences()?.baseCurrency ?? 'USD',
  );
  protected readonly saving = signal(false);
  protected readonly saveErrorKey = signal<string | null>(null);
  protected readonly titleKey = computed(() =>
    this.asset() ? 'investments.assets.form.editTitle' : 'investments.assets.form.newTitle',
  );
  protected readonly form = this.fb.nonNullable.group({
    symbol: ['', Validators.required],
    name: ['', Validators.required],
    assetClass: ['stock' as InvestmentAssetClass, Validators.required],
    currency: [this.baseCurrency(), Validators.required],
    quoteProvider: ['manual' as InvestmentQuoteProvider, Validators.required],
    manualPrice: ['', decimalAmountValidator(10)],
  });

  private readonly selectedProvider = toSignal(this.form.controls.quoteProvider.valueChanges, {
    initialValue: this.form.controls.quoteProvider.value,
  });
  /** A manual price always wins over a live quote once set (see asset_quotes.py). */
  protected readonly showManualPriceOverrideHint = computed(() => this.selectedProvider() !== 'manual');
  private readonly selectedAssetClass = toSignal(this.form.controls.assetClass.valueChanges, {
    initialValue: this.form.controls.assetClass.value,
  });
  protected readonly showCryptoCurrencyHint = computed(() => this.selectedAssetClass() === 'crypto');

  constructor() {
    effect(() => {
      if (!this.open()) return;
      const asset = this.asset();
      this.form.reset({
        symbol: asset?.symbol ?? '',
        name: asset?.name ?? '',
        assetClass: asset?.assetClass ?? 'stock',
        currency: asset?.currency ?? this.walletCurrency() ?? this.baseCurrency(),
        quoteProvider: asset?.quoteProvider ?? 'manual',
        manualPrice: asset?.manualPrice ?? '',
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
    const payload: InvestmentAssetCreate = {
      symbol: raw.symbol.trim(),
      name: raw.name.trim(),
      assetClass: raw.assetClass,
      currency: raw.currency,
      quoteProvider: raw.quoteProvider,
      manualPrice: raw.manualPrice || undefined,
      archived: false,
    };
    const asset = this.asset();
    this.saving.set(true);
    (asset ? this.assets.update(asset.id, payload) : this.assets.create(payload)).subscribe({
      next: (saved) => {
        this.saving.set(false);
        this.open.set(false);
        this.saved.emit(saved);
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.saveErrorKey.set(
          error instanceof ApiError ? `errors.${error.code}` : 'investments.assets.form.saveError',
        );
      },
    });
  }
}
