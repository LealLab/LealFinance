import { Component, computed, effect, inject, input, model, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslocoDirective } from '@jsverse/transloco';
import { MetadataService } from '../../core/metadata.service';
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
import { Modal } from '../../shared/ui/modal/modal';

const ASSET_CLASSES: readonly InvestmentAssetClass[] = ['stock', 'etf', 'fund', 'crypto', 'bond', 'other'];
const QUOTE_PROVIDERS: readonly InvestmentQuoteProvider[] = ['twelve_data', 'brapi', 'manual'];

/** t(investments.assets.form.newTitle, investments.assets.form.editTitle, investments.assets.form.saveError) */

@Component({
  selector: 'app-investment-asset-form-modal',
  imports: [ReactiveFormsModule, TranslocoDirective, Button, Modal],
  templateUrl: './investment-asset-form-modal.html',
})
export class InvestmentAssetFormModal {
  private readonly assets = inject(InvestmentAssetRepository);
  private readonly metadata = inject(MetadataService);
  private readonly preferences = inject(PreferenceService);
  private readonly fb = inject(FormBuilder);

  readonly open = model.required<boolean>();
  readonly asset = input<InvestmentAsset | undefined>(undefined);
  readonly saved = output<InvestmentAsset>();

  protected readonly assetClasses = ASSET_CLASSES;
  protected readonly quoteProviders = QUOTE_PROVIDERS;
  protected readonly currencyOptions = computed(() =>
    this.metadata.currencies().map((row) => row.code),
  );
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

  constructor() {
    effect(() => {
      if (!this.open()) return;
      const asset = this.asset();
      this.form.reset({
        symbol: asset?.symbol ?? '',
        name: asset?.name ?? '',
        assetClass: asset?.assetClass ?? 'stock',
        currency: asset?.currency ?? this.baseCurrency(),
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
      error: () => {
        this.saving.set(false);
        this.saveErrorKey.set('investments.assets.form.saveError');
      },
    });
  }
}
