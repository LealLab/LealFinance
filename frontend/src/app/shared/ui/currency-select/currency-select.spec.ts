import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DisplayCurrencyService } from '../../../core/display-currency.service';
import { MetadataService } from '../../../core/metadata.service';
import { PreferenceService } from '../../../core/preference.service';
import { CurrencySelect } from './currency-select';

const CURRENCIES = [
  { code: 'USD', name: 'US Dollar', symbol: '$', decimalDigits: 2, isActive: true },
  { code: 'BRL', name: 'Brazilian Real', symbol: 'R$', decimalDigits: 2, isActive: true },
  { code: 'EUR', name: 'Euro', symbol: '€', decimalDigits: 2, isActive: true },
];

function providers() {
  return [
    provideZonelessChangeDetection(),
    { provide: MetadataService, useValue: { currencies: signal(CURRENCIES) } },
    { provide: PreferenceService, useValue: { preferences: signal({ baseCurrency: 'BRL' }) } },
    { provide: DisplayCurrencyService, useValue: { currency: signal('USD') } },
  ];
}

@Component({
  selector: 'app-currency-select-form-host',
  imports: [CurrencySelect, ReactiveFormsModule],
  template: `<app-currency-select [id]="'currency'" [formControl]="control" />`,
})
class FormHost {
  readonly control = new FormBuilder().nonNullable.control('BRL', Validators.required);
}

@Component({
  selector: 'app-currency-select-standalone-host',
  imports: [CurrencySelect],
  template: `<app-currency-select [id]="'currency'" [value]="value()" (valueChange)="onChange($event)" />`,
})
class StandaloneHost {
  readonly value = signal('USD');
  readonly changes: string[] = [];
  onChange(next: string): void {
    this.value.set(next);
    this.changes.push(next);
  }
}

@Component({
  selector: 'app-currency-select-override-host',
  imports: [CurrencySelect, ReactiveFormsModule],
  template: `<app-currency-select [id]="'currency'" [formControl]="control" [currencies]="only" />`,
})
class OverrideHost {
  readonly control = new FormBuilder().nonNullable.control('USD');
  readonly only = [{ code: 'USD', name: 'US Dollar', symbol: '$', decimalDigits: 2, isActive: true }];
}

describe('CurrencySelect as a form control', () => {
  function setup() {
    TestBed.configureTestingModule({ imports: [FormHost], providers: providers() });
    const fixture = TestBed.createComponent(FormHost);
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('#currency') as HTMLInputElement;
    return { fixture, input };
  }

  it('writes the control value into the input', () => {
    const { input } = setup();
    expect(input.value).toBe('BRL');
  });

  it('uppercases typed input and propagates it to the control', () => {
    const { fixture, input } = setup();
    input.value = 'eur';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(input.value).toBe('EUR');
    expect(fixture.componentInstance.control.value).toBe('EUR');
    expect(fixture.componentInstance.control.valid).toBe(true);
  });

  it('marks the control invalid for text that is not a known active currency', () => {
    const { fixture, input } = setup();
    input.value = 'zzz';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(fixture.componentInstance.control.errors).toEqual({ invalidCurrency: true });
  });

  it('lists the base currency and the display currency before the rest', () => {
    const { fixture } = setup();
    const options = Array.from(
      fixture.nativeElement.querySelectorAll('datalist option'),
    ) as HTMLOptionElement[];
    expect(options.map((o) => o.value)).toEqual(['BRL', 'USD', 'EUR']);
  });
});

describe('CurrencySelect with a `currencies` override', () => {
  it('uses the input instead of MetadataService, e.g. the pre-login register page', () => {
    TestBed.configureTestingModule({
      imports: [OverrideHost],
      providers: [
        provideZonelessChangeDetection(),
        // Empty, as on the register page before SessionService ever calls
        // MetadataService.hydrate() - the override must not depend on it.
        { provide: MetadataService, useValue: { currencies: signal([]) } },
        { provide: PreferenceService, useValue: { preferences: signal(undefined) } },
        { provide: DisplayCurrencyService, useValue: { currency: signal('USD') } },
      ],
    });
    const fixture = TestBed.createComponent(OverrideHost);
    fixture.detectChanges();

    const options = Array.from(
      fixture.nativeElement.querySelectorAll('datalist option'),
    ) as HTMLOptionElement[];
    expect(options.map((o) => o.value)).toEqual(['USD']);
    expect(fixture.componentInstance.control.errors).toBeNull();
  });
});

describe('CurrencySelect as a standalone two-way binding', () => {
  it('reflects the bound value and emits on change, without any FormGroup', () => {
    TestBed.configureTestingModule({ imports: [StandaloneHost], providers: providers() });
    const fixture = TestBed.createComponent(StandaloneHost);
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('#currency') as HTMLInputElement;
    expect(input.value).toBe('USD');

    input.value = 'brl';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(fixture.componentInstance.changes).toEqual(['BRL']);
    expect(fixture.componentInstance.value()).toBe('BRL');
  });
});
