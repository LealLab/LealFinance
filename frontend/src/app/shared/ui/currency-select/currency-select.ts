import { Component, computed, forwardRef, inject, input, model, signal } from '@angular/core';
import { NG_VALIDATORS, NG_VALUE_ACCESSOR, ValidationErrors, Validator } from '@angular/forms';
import type { ControlValueAccessor } from '@angular/forms';
import { DisplayCurrencyService } from '../../../core/display-currency.service';
import { CurrencyMetadata } from '../../../core/identity.models';
import { MetadataService } from '../../../core/metadata.service';
import { PreferenceService } from '../../../core/preference.service';

/**
 * A searchable currency picker: `<input list>` bound to a `<datalist>`
 * rather than a `<select>` with 28+ bare codes - the browser's own
 * autocomplete does the filtering, with no popup/keyboard/focus-trap code
 * to get wrong and nothing to reimplement for mobile.
 *
 * Two ways to use it, matching the two shapes call sites already have:
 * - `formControlName="currency"` (every form modal) - drives itself through
 *   `ControlValueAccessor` + a `NG_VALIDATORS` entry that fails typed text
 *   which isn't a known active currency code.
 * - `[value]`/`(valueChange)` (Settings' standalone display-currency
 *   picker, which isn't part of any FormGroup) - the same two-way `model()`
 *   shape `app-modal`'s `[(open)]` uses.
 *
 * `value` doubles as both: it's the model a plain `[value]` binding reads
 * and writes, and also what `writeValue`/`onInput` below read and set for
 * the CVA path - one signal, either caller.
 *
 * Options are ordered with the most likely picks first - the user's base
 * currency, their display currency, then any codes the caller passes via
 * `suggest` (e.g. currencies already in use elsewhere on the same screen) -
 * followed by every other active currency. `<datalist>` can't render an
 * `<optgroup>` header, so "suggested" is ordering, not a visible section.
 */
@Component({
  selector: 'app-currency-select',
  imports: [],
  templateUrl: './currency-select.html',
  // The inner <input class="form-input"> is a block box either way (block
  // children establish their own containing block past an inline
  // ancestor), but a caller constraining width via a class on this host
  // tag (e.g. `class="max-w-xs"`) needs the host itself to be block-level
  // for max-width to apply at all.
  host: { class: 'block' },
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => CurrencySelect),
      multi: true,
    },
    {
      provide: NG_VALIDATORS,
      useExisting: forwardRef(() => CurrencySelect),
      multi: true,
    },
  ],
})
export class CurrencySelect implements ControlValueAccessor, Validator {
  private readonly metadata = inject(MetadataService);
  private readonly preferences = inject(PreferenceService);
  private readonly displayCurrency = inject(DisplayCurrencyService);

  /** Id applied to the underlying `<input>`, so an external `<label for>`
   * still associates correctly. Bind it: `[id]="'account-currency'"`. */
  readonly id = input.required<string>();
  /** Extra codes to list before the rest - e.g. currencies already used by
   * accounts on the same screen. */
  readonly suggest = input<readonly string[]>([]);
  /** Overrides MetadataService.currencies() - for the one screen that
   * renders before a session exists (register), where MetadataService is
   * never hydrated (see SessionService.ensureLoaded) and the caller fetches
   * the public /meta/currencies list itself instead. */
  readonly currencies = input<readonly CurrencyMetadata[] | undefined>(undefined);

  /** See the class doc comment - a plain two-way model for a standalone
   * caller, and what the CVA methods below read/write for a form caller. */
  readonly value = model('');
  /** For a caller outside a FormGroup's own disable() state, e.g. "not
   * editable once the record exists" - ORed with the CVA disabled state. */
  readonly disabled = input(false);

  protected readonly listId = computed(() => `${this.id()}-options`);

  private readonly activeCurrencies = computed(
    () => this.currencies() ?? this.metadata.currencies(),
  );
  private readonly byCode = computed(
    () => new Map(this.activeCurrencies().map((row) => [row.code, row])),
  );

  protected readonly orderedCurrencies = computed<CurrencyMetadata[]>(() => {
    const priority = [
      this.preferences.preferences()?.baseCurrency,
      this.displayCurrency.currency(),
      ...this.suggest(),
    ].filter((code): code is string => !!code);

    const byCode = this.byCode();
    const seen = new Set<string>();
    const ordered: CurrencyMetadata[] = [];
    for (const code of priority) {
      const row = byCode.get(code);
      if (row && !seen.has(code)) {
        ordered.push(row);
        seen.add(code);
      }
    }
    for (const row of this.activeCurrencies()) {
      if (!seen.has(row.code)) {
        ordered.push(row);
        seen.add(row.code);
      }
    }
    return ordered;
  });

  private readonly cvaDisabled = signal(false);
  protected readonly isDisabled = computed(() => this.disabled() || this.cvaDisabled());
  // eslint-disable-next-line @typescript-eslint/no-empty-function -- replaced by registerOnChange
  private onChange: (value: string) => void = () => {};
  // eslint-disable-next-line @typescript-eslint/no-empty-function -- replaced by registerOnTouched
  private onTouched: () => void = () => {};

  writeValue(value: string | null): void {
    this.value.set(value ?? '');
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.cvaDisabled.set(isDisabled);
  }

  validate(): ValidationErrors | null {
    const code = this.value();
    if (!code) return null; // Validators.required (if any) reports this case.
    const known = this.byCode();
    if (known.size === 0) return null; // Metadata not hydrated yet - nothing to judge against.
    return known.has(code) ? null : { invalidCurrency: true };
  }

  protected onInput(raw: string): void {
    const code = raw.trim().toUpperCase();
    this.value.set(code);
    this.onChange(code);
  }

  protected onBlur(): void {
    this.onTouched();
  }
}
