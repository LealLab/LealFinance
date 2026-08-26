import { Component, computed, effect, inject, input, model, output, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslocoDirective } from '@jsverse/transloco';
import { MetadataService } from '../../core/metadata.service';
import { PreferenceService } from '../../core/preference.service';
import { AccountRepository } from '../../data/account.repository';
import { InstitutionRepository } from '../../data/institution.repository';
import {
  InvestmentWalletCreate,
  InvestmentWalletRepository,
} from '../../data/investment-wallet.repository';
import { InvestmentWallet } from '../../domain/models/investment';
import { groupAccountsByInstitution } from '../accounts/institution-grouping';
import { Button } from '../../shared/ui/button/button';
import { Modal } from '../../shared/ui/modal/modal';

/** t(investments.form.newTitle, investments.form.editTitle, investments.form.saveError) */

@Component({
  selector: 'app-investment-wallet-form-modal',
  imports: [ReactiveFormsModule, TranslocoDirective, Button, Modal],
  templateUrl: './investment-wallet-form-modal.html',
  styleUrl: './investment-wallet-form-modal.scss',
})
export class InvestmentWalletFormModal {
  private readonly wallets = inject(InvestmentWalletRepository);
  private readonly accounts = inject(AccountRepository);
  private readonly institutions = inject(InstitutionRepository);
  private readonly metadata = inject(MetadataService);
  private readonly preferences = inject(PreferenceService);
  private readonly fb = inject(FormBuilder);

  readonly open = model.required<boolean>();
  readonly wallet = input<InvestmentWallet | undefined>(undefined);
  readonly saved = output<InvestmentWallet>();

  protected readonly currencyOptions = computed(() =>
    this.metadata.currencies().map((row) => row.code),
  );
  private readonly baseCurrency = computed(
    () => this.preferences.preferences()?.baseCurrency ?? 'USD',
  );
  protected readonly accountsResource = rxResource({ stream: () => this.accounts.list() });
  protected readonly institutionsResource = rxResource({ stream: () => this.institutions.list() });
  protected readonly cashAccounts = computed(() =>
    (this.accountsResource.value() ?? []).filter(
      (account) => account.type !== 'investment' && !account.archived,
    ),
  );
  protected readonly cashAccountGroups = computed(() =>
    groupAccountsByInstitution(this.cashAccounts(), this.institutionsResource.value() ?? []),
  );
  protected readonly saving = signal(false);
  protected readonly saveErrorKey = signal<string | null>(null);
  protected readonly isEditing = computed(() => this.wallet() !== undefined);
  protected readonly titleKey = computed(() =>
    this.wallet() ? 'investments.form.editTitle' : 'investments.form.newTitle',
  );

  protected readonly form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    currency: [this.baseCurrency(), Validators.required],
    cashAccountId: [''],
    institutionId: [''],
  });

  constructor() {
    effect(() => {
      if (!this.open()) return;
      this.accountsResource.reload();
      this.institutionsResource.reload();
      const wallet = this.wallet();
      this.form.reset({
        name: wallet?.name ?? '',
        currency: wallet?.currency ?? this.baseCurrency(),
        cashAccountId: wallet?.cashAccountId ?? '',
        institutionId: wallet?.institutionId ?? '',
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
    const payload: InvestmentWalletCreate = {
      name: raw.name.trim(),
      currency: raw.currency,
      cashAccountId: raw.cashAccountId || undefined,
      institutionId: raw.institutionId || undefined,
      archived: false,
    };
    const wallet = this.wallet();
    this.saving.set(true);
    (wallet ? this.wallets.update(wallet.id, payload) : this.wallets.create(payload)).subscribe({
      next: (saved) => {
        this.saving.set(false);
        this.open.set(false);
        this.saved.emit(saved);
      },
      error: () => {
        this.saving.set(false);
        this.saveErrorKey.set('investments.form.saveError');
      },
    });
  }
}
