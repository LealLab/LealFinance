import { Component, computed, effect, inject, input, model, output, signal } from '@angular/core';
import { rxResource, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslocoDirective } from '@jsverse/transloco';
import { Account, AccountType } from '../../domain/models/account';
import { AccountRepository } from '../../data/account.repository';
import { InstitutionRepository } from '../../data/institution.repository';
import { Institution } from '../../domain/models/institution';
import { MetadataService } from '../../core/metadata.service';
import { PreferenceService } from '../../core/preference.service';
import { decimalAmountValidator } from '../../shared/money/decimal-amount.validator';
import { Button } from '../../shared/ui/button/button';
import { Icon } from '../../shared/ui/icon/icon';
import { Modal } from '../../shared/ui/modal/modal';
import { ACCOUNT_TYPE_OPTIONS } from './account-type';
import { InstitutionFormModal } from './institution-form-modal';

/**
 * Create/edit form for an Account, in a modal (per the project's decision
 * for all create/edit flows - see the brainstorming spec). One instance is
 * reused by the accounts list and detail screens for both "new" and "edit"
 * - which mode it's in is entirely driven by whether `account` is set, and
 * the form repopulates whenever the modal opens.
 *
 * The institution picker's "+ Nova instituição" affordance is a small
 * button next to the `<select>` that opens a second, nested
 * `InstitutionFormModal` - not a native `<dialog>`-in-`<dialog>` triggered
 * by a special `<option>` value. Both are viable (native `<dialog>`s do
 * stack correctly), but a dedicated button keeps the interaction obvious
 * and keeps "create a new institution" out of the `<select>`'s own value
 * space, so accidentally selecting it can't be confused with picking a
 * real institution.
 */
@Component({
  selector: 'app-account-form-modal',
  imports: [ReactiveFormsModule, TranslocoDirective, Modal, Button, Icon, InstitutionFormModal],
  templateUrl: './account-form-modal.html',
})
export class AccountFormModal {
  private readonly accounts = inject(AccountRepository);
  private readonly institutions = inject(InstitutionRepository);
  private readonly fb = inject(FormBuilder);
  private readonly metadata = inject(MetadataService);
  private readonly preferences = inject(PreferenceService);

  readonly open = model.required<boolean>();
  readonly account = input<Account | undefined>(undefined);
  readonly saved = output<Account>();

  protected readonly accountTypeOptions = ACCOUNT_TYPE_OPTIONS;
  protected readonly currencyOptions = computed(() =>
    this.metadata.currencies().map((row) => row.code),
  );
  private readonly baseCurrency = computed(
    () => this.preferences.preferences()?.baseCurrency ?? 'USD',
  );

  protected readonly institutionsResource = rxResource({
    stream: () => this.institutions.list(),
  });
  protected readonly accountsResource = rxResource({
    stream: () => this.accounts.list(),
  });
  protected readonly institutionFormOpen = signal(false);

  protected readonly saving = signal(false);
  protected readonly saveErrorKey = signal<string | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    type: ['checking' as AccountType, Validators.required],
    currency: [this.baseCurrency(), Validators.required],
    openingBalance: ['0', [Validators.required, decimalAmountValidator()]],
    institutionId: [''],
    creditLimit: ['', decimalAmountValidator()],
    closingDay: this.fb.control<number | null>(null, [Validators.min(1), Validators.max(31)]),
    dueDay: this.fb.control<number | null>(null, [Validators.min(1), Validators.max(31)]),
    paymentAccountId: [''],
    autoPay: [false],
  });

  private readonly selectedType = toSignal(this.form.controls.type.valueChanges, {
    initialValue: this.form.controls.type.value,
  });
  private readonly selectedCurrency = toSignal(this.form.controls.currency.valueChanges, {
    initialValue: this.form.controls.currency.value,
  });
  private readonly selectedPaymentAccount = toSignal(
    this.form.controls.paymentAccountId.valueChanges,
    { initialValue: this.form.controls.paymentAccountId.value },
  );
  protected readonly isCreditCard = computed(() => this.selectedType() === 'credit_card');

  /** Accounts that can pay this card's invoices: the user's own, not a
   * card, not archived, same currency, and not the card being edited. */
  protected readonly paymentAccountOptions = computed(() => {
    const currency = this.selectedCurrency();
    const selfId = this.account()?.id;
    return (this.accountsResource.value() ?? []).filter(
      (a) => a.type !== 'credit_card' && !a.archived && a.currency === currency && a.id !== selfId,
    );
  });

  /** auto_pay needs a payment account - both DB-enforced and here. */
  protected readonly canAutoPay = computed(() => !!this.selectedPaymentAccount());

  /**
   * titleKey/saveErrorKey below hold these as plain string literals, only
   * ever reached through the template's translation call - see
   * layout/sidebar.ts for why that needs a JSDoc "dynamic markings" block
   * to avoid a false orphaned-key report:
   * t(accounts.form.editTitle, accounts.form.newTitle, accounts.form.saveError)
   */
  protected readonly titleKey = computed(() =>
    this.account() ? 'accounts.form.editTitle' : 'accounts.form.newTitle',
  );

  constructor() {
    // Repopulate the form every time the modal opens, from whatever
    // `account` currently is - this is what lets one modal instance
    // serve both "new" (account undefined) and "edit" (account set).
    effect(() => {
      if (!this.open()) return;
      // These resources are owned by the account modal, so they may be
      // stale after an institution or account was created from the
      // Accounts page while the modal was closed.
      this.institutionsResource.reload();
      this.accountsResource.reload();
      const account = this.account();
      this.form.reset({
        name: account?.name ?? '',
        type: account?.type ?? 'checking',
        currency: account?.currency ?? this.baseCurrency(),
        openingBalance: account?.openingBalance ?? '0',
        institutionId: account?.institutionId ?? '',
        creditLimit: account?.creditLimit ?? '',
        closingDay: account?.closingDay ?? null,
        dueDay: account?.dueDay ?? null,
        paymentAccountId: account?.paymentAccountId ?? '',
        autoPay: account?.autoPay ?? false,
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
    const isCreditCard = raw.type === 'credit_card';
    const paymentAccountId = isCreditCard && raw.paymentAccountId ? raw.paymentAccountId : undefined;
    const payload: Omit<Account, 'id'> = {
      name: raw.name.trim(),
      type: raw.type,
      currency: raw.currency,
      openingBalance: raw.openingBalance,
      institutionId: raw.institutionId || undefined,
      archived: this.account()?.archived ?? false,
      creditLimit: isCreditCard && raw.creditLimit ? raw.creditLimit : undefined,
      closingDay: isCreditCard && raw.closingDay ? raw.closingDay : undefined,
      dueDay: isCreditCard && raw.dueDay ? raw.dueDay : undefined,
      paymentAccountId,
      autoPay: isCreditCard && paymentAccountId ? raw.autoPay : false,
    };

    this.saving.set(true);
    const existing = this.account();
    const request$ = existing
      ? this.accounts.update(existing.id, payload)
      : this.accounts.create(payload);

    request$.subscribe({
      next: (account) => {
        this.saving.set(false);
        this.open.set(false);
        this.saved.emit(account);
      },
      error: () => {
        this.saving.set(false);
        this.saveErrorKey.set('accounts.form.saveError');
      },
    });
  }

  protected openCreateInstitution(): void {
    this.institutionFormOpen.set(true);
  }

  /** After creating one from within this form, pick it and refresh the list it's drawn from. */
  protected onInstitutionCreated(institution: Institution): void {
    this.institutionsResource.reload();
    this.form.controls.institutionId.setValue(institution.id);
  }
}
