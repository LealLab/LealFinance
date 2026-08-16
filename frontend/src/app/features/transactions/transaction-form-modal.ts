import { Component, computed, effect, inject, input, model, output, signal } from '@angular/core';
import { rxResource, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslocoDirective } from '@jsverse/transloco';
import { of } from 'rxjs';
import { ExchangeRateRepository } from '../../data/exchange-rate.repository';
import { RecurringRuleRepository } from '../../data/recurring-rule.repository';
import { TransactionRepository } from '../../data/transaction.repository';
import { formatIsoDate } from '../../domain/calc/dates';
import { Account } from '../../domain/models/account';
import { Category } from '../../domain/models/category';
import { Institution } from '../../domain/models/institution';
import { RecurringFrequency } from '../../domain/models/recurring';
import { Transaction, TransactionType } from '../../domain/models/transaction';
import { groupAccountsByInstitution } from '../accounts/institution-grouping';
import { buildTransactionConversion, prefillConvertedAmount } from './conversion-form';
import { MetadataService } from '../../core/metadata.service';
import { PreferenceService } from '../../core/preference.service';
import { decimalAmountValidator } from '../../shared/money/decimal-amount.validator';
import { money, subtract, zero } from '../../shared/money/money';
import { effectiveRate } from '../../shared/money/rate';
import { Button } from '../../shared/ui/button/button';
import { ExchangeRateWarning } from '../../shared/exchange-rate-warning/exchange-rate-warning';
import { Modal } from '../../shared/ui/modal/modal';

const TRANSACTION_TYPES: readonly TransactionType[] = ['expense', 'income', 'transfer'];
const FREQUENCIES: readonly RecurringFrequency[] = ['weekly', 'monthly', 'yearly'];

/**
 * Create/edit form for a Transaction - income/expense/transfer share one
 * modal with a segmented type control that swaps which fields apply (see
 * transaction-form-modal.html). Creating with "repeat" checked also
 * creates a RecurringRule from the same fields (edit doesn't offer this -
 * promoting an *existing* transaction into a rule after the fact is a
 * separate, more involved flow this scaffold doesn't cover).
 *
 * `fromInstitutionId`/`toInstitutionId` are transfer-only, UI-only filter
 * controls - they narrow which accounts the two transfer selects offer,
 * but are never part of the payload sent to TransactionRepository
 * (Transaction itself has no institution fields; a transfer's institutions
 * are implied by its two accounts). `toInstitutionId` defaults to the
 * source account's own institution whenever the source account changes,
 * so a same-institution transfer needs no extra clicks - see the
 * `accountId.valueChanges` subscription below.
 *
 * `currency`/`convertedAmount`/`fee` back the "Conversion" fieldset that
 * appears whenever this transaction is cross-currency - a transfer between
 * accounts of different currencies, or (for income/expense) a `currency`
 * different from the posting account's own. The converted amount prefills
 * from a live/mock quote (`rateResource`) net of the fee, per
 * docs/money-and-currency.md's `converted = (amount - fee) * rate` rule -
 * see conversion-form.ts for that math - but a user edit to the converted
 * amount is never overwritten again (`convertedTouched`).
 */
@Component({
  selector: 'app-transaction-form-modal',
  imports: [ReactiveFormsModule, TranslocoDirective, Modal, Button, ExchangeRateWarning],
  templateUrl: './transaction-form-modal.html',
  styleUrl: './transaction-form-modal.scss'
})
export class TransactionFormModal {
  private readonly transactions = inject(TransactionRepository);
  private readonly recurringRules = inject(RecurringRuleRepository);
  private readonly exchangeRates = inject(ExchangeRateRepository);
  private readonly fb = inject(FormBuilder);
  private readonly metadata = inject(MetadataService);
  private readonly preferences = inject(PreferenceService);

  readonly open = model.required<boolean>();
  readonly transaction = input<Transaction | undefined>(undefined);
  readonly accounts = input.required<Account[]>();
  readonly categories = input.required<Category[]>();
  readonly institutions = input<Institution[]>([]);
  readonly saved = output<void>();

  protected readonly transactionTypes = TRANSACTION_TYPES;
  protected readonly frequencies = FREQUENCIES;
  protected readonly currencyOptions = computed(() =>
    this.metadata.currencies().map((row) => row.code)
  );
  private readonly baseCurrency = computed(
    () => this.preferences.preferences()?.baseCurrency ?? 'USD',
  );
  protected readonly saving = signal(false);
  protected readonly saveErrorKey = signal<string | null>(null);

  /** True while the constructor effect is repopulating the form on open - see the note above `clearAccountIfMismatched`. */
  private applyingReset = false;

  /** True once the user has typed into `convertedAmount` themselves - the prefill effect below never overwrites it again. */
  protected readonly convertedTouched = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    type: ['expense' as TransactionType, Validators.required],
    date: [formatIsoDate(new Date()), Validators.required],
    amount: ['', [Validators.required, decimalAmountValidator()]],
    currency: [this.baseCurrency(), Validators.required],
    accountId: ['', Validators.required],
    toAccountId: [''],
    categoryId: [''],
    description: ['', Validators.required],
    notes: [''],
    repeat: [false],
    frequency: ['monthly' as RecurringFrequency],
    interval: [1, [Validators.min(1)]],
    fromInstitutionId: [''],
    toInstitutionId: [''],
    convertedAmount: ['', decimalAmountValidator()],
    fee: ['', decimalAmountValidator()]
  });

  private readonly selectedType = toSignal(this.form.controls.type.valueChanges, {
    initialValue: this.form.controls.type.value
  });
  protected readonly isTransfer = computed(() => this.selectedType() === 'transfer');

  protected readonly categoryOptions = computed(() => {
    const kind = this.isTransfer() ? undefined : this.selectedType() === 'income' ? 'income' : 'expense';
    return this.categories().filter((category) => !category.archived && category.kind === kind);
  });

  /** <optgroup>-per-institution for the plain (non-transfer) account select. */
  protected readonly accountGroups = computed(() =>
    groupAccountsByInstitution(this.accounts(), this.institutions())
  );

  private readonly selectedFromInstitutionId = toSignal(this.form.controls.fromInstitutionId.valueChanges, {
    initialValue: this.form.controls.fromInstitutionId.value
  });
  private readonly selectedToInstitutionId = toSignal(this.form.controls.toInstitutionId.valueChanges, {
    initialValue: this.form.controls.toInstitutionId.value
  });

  protected readonly fromAccountOptions = computed(() => {
    const institutionId = this.selectedFromInstitutionId();
    const accounts = this.accounts();
    return institutionId ? accounts.filter((account) => account.institutionId === institutionId) : accounts;
  });
  protected readonly toAccountOptions = computed(() => {
    const institutionId = this.selectedToInstitutionId();
    const accounts = this.accounts();
    return institutionId ? accounts.filter((account) => account.institutionId === institutionId) : accounts;
  });

  private readonly selectedAccountId = toSignal(this.form.controls.accountId.valueChanges, {
    initialValue: this.form.controls.accountId.value
  });
  private readonly selectedToAccountId = toSignal(this.form.controls.toAccountId.valueChanges, {
    initialValue: this.form.controls.toAccountId.value
  });
  private readonly selectedCurrency = toSignal(this.form.controls.currency.valueChanges, {
    initialValue: this.form.controls.currency.value
  });
  private readonly selectedDate = toSignal(this.form.controls.date.valueChanges, {
    initialValue: this.form.controls.date.value
  });
  private readonly selectedAmount = toSignal(this.form.controls.amount.valueChanges, {
    initialValue: this.form.controls.amount.value
  });
  private readonly selectedFee = toSignal(this.form.controls.fee.valueChanges, {
    initialValue: this.form.controls.fee.value
  });
  private readonly selectedConvertedAmount = toSignal(this.form.controls.convertedAmount.valueChanges, {
    initialValue: this.form.controls.convertedAmount.value
  });

  private readonly sourceAccount = computed(() =>
    this.accounts().find((account) => account.id === this.selectedAccountId())
  );
  private readonly destinationAccount = computed(() =>
    this.accounts().find((account) => account.id === this.selectedToAccountId())
  );

  /**
   * The transaction's own currency (what `Transaction.currency` will be) -
   * the source account's currency for a transfer, or the freely-chosen
   * `currency` control for income/expense. See domain/models/transaction.ts.
   */
  protected readonly originCurrency = computed(() =>
    this.isTransfer() ? this.sourceAccount()?.currency : this.selectedCurrency()
  );
  /** The currency of the account this transaction actually posts to. */
  protected readonly destinationCurrency = computed(() =>
    this.isTransfer() ? this.destinationAccount()?.currency : this.sourceAccount()?.currency
  );
  protected readonly crossCurrency = computed(() => {
    const origin = this.originCurrency();
    const destination = this.destinationCurrency();
    return !!origin && !!destination && origin !== destination;
  });

  /** Live/mock quote for the current pair - only fetched while this transaction is actually cross-currency. */
  protected readonly rateResource = rxResource({
    params: () => ({
      crossCurrency: this.crossCurrency(),
      origin: this.originCurrency(),
      destination: this.destinationCurrency(),
      asOf: this.selectedDate()
    }),
    stream: ({ params }) =>
      params.crossCurrency && params.origin && params.destination
        ? this.exchangeRates.getRate(params.origin, params.destination, params.asOf)
        : of(undefined)
  });
  protected readonly rateIsFallback = computed(() => this.rateResource.value()?.isFallback ?? false);

  /** What `converted ÷ (amount - fee)` currently works out to, for display next to the converted-amount field - `null` until there's enough to compute it. */
  protected readonly effectiveRateHint = computed(() => {
    const origin = this.originCurrency();
    const destination = this.destinationCurrency();
    const amount = this.selectedAmount();
    const convertedAmount = this.selectedConvertedAmount();
    if (!origin || !destination || !amount || !convertedAmount) return null;
    try {
      const fee = this.selectedFee();
      const netOrigin = subtract(money(amount, origin), fee ? money(fee, origin) : zero(origin));
      return effectiveRate(netOrigin, money(convertedAmount, destination));
    } catch {
      return null;
    }
  });

  /**
   * titleKey/saveErrorKey hold these as plain string literals, only ever
   * passed to the marker function from the template - see
   * account-form-modal.ts / layout/sidebar.ts for why that needs this
   * JSDoc "dynamic markings" block:
   * t(transactions.form.editTitle, transactions.form.newTitle, transactions.form.saveError, transactions.form.errors.invalid, transactions.form.errors.convertedAmountRequired)
   */
  protected readonly titleKey = computed(() =>
    this.transaction() ? 'transactions.form.editTitle' : 'transactions.form.newTitle'
  );

  constructor() {
    effect(() => {
      if (!this.open()) return;
      const tx = this.transaction();
      const accounts = this.accounts();
      const fromAccount = accounts.find((account) => account.id === tx?.accountId);
      const toAccount = accounts.find((account) => account.id === tx?.toAccountId);

      // Guarded so the sync subscriptions below don't treat this
      // programmatic repopulation as a user edit and clear the very
      // selections it just set (e.g. a cross-institution transfer being
      // edited would otherwise lose its toAccountId the instant the modal
      // opens).
      this.applyingReset = true;
      this.form.reset({
        type: tx?.type ?? 'expense',
        date: tx?.date ?? formatIsoDate(new Date()),
        amount: tx?.amount ?? '',
        currency: tx?.currency ?? fromAccount?.currency ?? this.baseCurrency(),
        accountId: tx?.accountId ?? '',
        toAccountId: tx?.toAccountId ?? '',
        categoryId: tx?.categoryId ?? '',
        description: tx?.description ?? '',
        notes: tx?.notes ?? '',
        repeat: false,
        frequency: 'monthly',
        interval: 1,
        fromInstitutionId: fromAccount?.institutionId ?? '',
        toInstitutionId: toAccount?.institutionId ?? '',
        convertedAmount: tx?.conversion?.amount ?? '',
        fee: tx?.conversion?.fee ?? ''
      });
      this.applyingReset = false;
      // A conversion already on record is treated as "touched" so the
      // prefill effect below doesn't immediately overwrite it with a fresh
      // quote the moment the modal opens.
      this.convertedTouched.set(!!tx?.conversion);
      this.saveErrorKey.set(null);
    });

    // Prefills convertedAmount from the live/mock rate, net of the fee -
    // but never once the user has edited it themselves (convertedTouched).
    // emitEvent: false so this programmatic write doesn't itself flip
    // convertedTouched back to true via the subscription below.
    effect(() => {
      const rate = this.rateResource.value();
      const origin = this.originCurrency();
      const destination = this.destinationCurrency();
      const amount = this.selectedAmount();
      const fee = this.selectedFee();
      if (!this.crossCurrency() || !rate || !origin || !destination || !amount || this.convertedTouched()) {
        return;
      }
      try {
        const prefilled = prefillConvertedAmount(amount, origin, fee || null, rate.rate, destination);
        this.form.controls.convertedAmount.setValue(prefilled, { emitEvent: false });
      } catch {
        // amount/fee isn't a valid decimal yet - leave the field as-is until it is.
      }
    });

    // Defaulting toInstitutionId to the source account's own institution
    // (transfers) or currency to the account's own (income/expense)
    // whenever the source account changes - see the class-level doc
    // comment for why, and clearAccountIfMismatched for the symmetric
    // "narrowing a filter drops a now-invalid selection" behavior. Any
    // account change also means "this is a different currency pair now",
    // so any prior converted-amount edit no longer applies.
    this.form.controls.accountId.valueChanges.subscribe((accountId) => {
      if (this.applyingReset) return;
      this.convertedTouched.set(false);
      const account = this.accounts().find((a) => a.id === accountId);
      if (this.form.controls.type.value === 'transfer') {
        this.form.controls.toInstitutionId.setValue(account?.institutionId ?? '');
      } else {
        this.form.controls.currency.setValue(account?.currency ?? this.baseCurrency());
      }
    });

    this.form.controls.toAccountId.valueChanges.subscribe(() => {
      if (this.applyingReset) return;
      this.convertedTouched.set(false);
    });
    this.form.controls.currency.valueChanges.subscribe(() => {
      if (this.applyingReset) return;
      this.convertedTouched.set(false);
    });
    this.form.controls.type.valueChanges.subscribe(() => {
      if (this.applyingReset) return;
      this.convertedTouched.set(false);
    });
    this.form.controls.convertedAmount.valueChanges.subscribe(() => {
      if (this.applyingReset) return;
      this.convertedTouched.set(true);
    });

    this.form.controls.fromInstitutionId.valueChanges.subscribe((institutionId) => {
      if (this.applyingReset) return;
      this.clearAccountIfMismatched('accountId', institutionId);
    });
    this.form.controls.toInstitutionId.valueChanges.subscribe((institutionId) => {
      if (this.applyingReset) return;
      this.clearAccountIfMismatched('toAccountId', institutionId);
    });
  }

  /**
   * Narrowing an institution filter (fromInstitutionId/toInstitutionId) to
   * something specific drops the currently-selected account on that side
   * if it no longer belongs to that institution - rather than silently
   * keeping a selection the filtered <select> no longer even lists.
   */
  private clearAccountIfMismatched(controlName: 'accountId' | 'toAccountId', institutionId: string): void {
    if (!institutionId) return;
    const control = this.form.controls[controlName];
    const account = this.accounts().find((a) => a.id === control.value);
    if (account && account.institutionId !== institutionId) {
      control.setValue('');
    }
  }

  protected submit(): void {
    const raw = this.form.getRawValue();
    const isTransfer = raw.type === 'transfer';
    const crossCurrency = this.crossCurrency();

    if (
      this.form.controls.type.invalid ||
      this.form.controls.date.invalid ||
      this.form.controls.amount.invalid ||
      this.form.controls.currency.invalid ||
      this.form.controls.accountId.invalid ||
      this.form.controls.description.invalid ||
      this.form.controls.fee.invalid ||
      (isTransfer && (!raw.toAccountId || raw.toAccountId === raw.accountId)) ||
      (!isTransfer && !raw.categoryId) ||
      (crossCurrency && (this.form.controls.convertedAmount.invalid || !raw.convertedAmount))
    ) {
      this.form.markAllAsTouched();
      this.saveErrorKey.set(
        crossCurrency && !raw.convertedAmount
          ? 'transactions.form.errors.convertedAmountRequired'
          : 'transactions.form.errors.invalid'
      );
      return;
    }

    const account = this.accounts().find((a) => a.id === raw.accountId);
    if (!account) return;
    const toAccount = isTransfer ? this.accounts().find((a) => a.id === raw.toAccountId) : undefined;

    const originCurrency = isTransfer ? account.currency : raw.currency;
    const destinationCurrency = isTransfer ? toAccount?.currency : account.currency;

    const conversion =
      crossCurrency && destinationCurrency
        ? buildTransactionConversion({
            originAmount: raw.amount,
            originCurrency,
            fee: raw.fee || null,
            convertedAmount: raw.convertedAmount,
            destinationCurrency,
            quoteSource: this.rateResource.value()?.isFallback ? 'fallback' : 'quote',
            convertedTouched: this.convertedTouched()
          })
        : undefined;

    const basePayload: Omit<Transaction, 'id'> = {
      type: raw.type,
      date: raw.date,
      amount: raw.amount,
      currency: originCurrency,
      accountId: raw.accountId,
      toAccountId: isTransfer ? raw.toAccountId : undefined,
      categoryId: isTransfer ? undefined : raw.categoryId,
      description: raw.description.trim(),
      notes: raw.notes.trim() || undefined,
      conversion
    };

    this.saving.set(true);
    const existing = this.transaction();

    if (existing) {
      this.transactions.update(existing.id, basePayload).subscribe({
        next: () => this.onSaveSuccess(),
        error: () => this.onSaveError()
      });
      return;
    }

    if (raw.repeat && !isTransfer && !crossCurrency) {
      this.recurringRules
        .create({
          frequency: raw.frequency,
          interval: raw.interval,
          startDate: raw.date,
          template: {
            type: basePayload.type,
            amount: basePayload.amount,
            currency: basePayload.currency,
            accountId: basePayload.accountId,
            categoryId: basePayload.categoryId,
            description: basePayload.description,
            notes: basePayload.notes
          }
        })
        .subscribe({
          next: (rule) => {
            this.transactions
              .create({ ...basePayload, recurringRuleId: rule.id })
              .subscribe({ next: () => this.onSaveSuccess(), error: () => this.onSaveError() });
          },
          error: () => this.onSaveError()
        });
      return;
    }

    this.transactions.create(basePayload).subscribe({
      next: () => this.onSaveSuccess(),
      error: () => this.onSaveError()
    });
  }

  private onSaveSuccess(): void {
    this.saving.set(false);
    this.open.set(false);
    this.saved.emit();
  }

  private onSaveError(): void {
    this.saving.set(false);
    this.saveErrorKey.set('transactions.form.saveError');
  }
}
