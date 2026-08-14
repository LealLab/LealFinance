import { Component, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { provideTranslocoLocale } from '@jsverse/transloco-locale';
import { BalanceVisibilityService } from '../../core/balance-visibility.service';
import { MoneyPipe } from './money.pipe';

// Intl.NumberFormat separates the currency symbol from the amount with a
// non-breaking space (U+00A0), not a regular space (U+0020). Built via
// fromCharCode (rather than embedding the literal character) so the
// invisible codepoint can't be silently normalized to a regular space by
// file-editing tooling and quietly turn this into a mismatch that looks
// correct at a glance.
const NBSP = String.fromCharCode(160);

describe('MoneyPipe', () => {
  let pipe: MoneyPipe;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: {},
          translocoConfig: { availableLangs: ['pt-BR'], defaultLang: 'pt-BR' }
        })
      ],
      providers: [
        provideTranslocoLocale({ defaultLocale: 'pt-BR', defaultCurrency: 'BRL' }),
        provideZonelessChangeDetection()
      ]
    });
    pipe = TestBed.runInInjectionContext(() => new MoneyPipe());
  });

  it('formats a BRL amount using pt-BR grouping/decimal conventions', () => {
    expect(pipe.transform('1234.5', 'BRL')).toBe(`R$${NBSP}1.234,50`);
  });

  it("uses BRL's 2 decimal digits without a hardcoded default", () => {
    // No fraction-digit option is passed by MoneyPipe - Intl derives 2
    // decimal places from the currency code itself (ISO 4217), which is
    // the point: it isn't hardcoded, so JPY/BHD would format correctly
    // too, with 0 or 3 digits respectively, once supported.
    expect(pipe.transform('10', 'BRL')).toBe(`R$${NBSP}10,00`);
  });

  it('masks the amount instead of formatting it once balances are hidden', () => {
    TestBed.inject(BalanceVisibilityService).setHidden(true);

    expect(pipe.transform('1234.5', 'BRL')).toBe('••••');
  });
});

@Component({
  selector: 'app-money-pipe-host',
  imports: [MoneyPipe],
  template: `{{ amount | money: 'BRL' }}`
})
class MoneyPipeHost {
  amount = '1234.5';
}

describe('MoneyPipe reactivity to BalanceVisibilityService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [
        MoneyPipeHost,
        TranslocoTestingModule.forRoot({
          langs: {},
          translocoConfig: { availableLangs: ['pt-BR'], defaultLang: 'pt-BR' }
        })
      ],
      providers: [
        provideTranslocoLocale({ defaultLocale: 'pt-BR', defaultCurrency: 'BRL' }),
        provideZonelessChangeDetection()
      ]
    });
  });

  it('re-renders through a single normal change-detection tick when the hidden signal toggles', () => {
    const fixture = TestBed.createComponent(MoneyPipeHost);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toBe(`R$${NBSP}1.234,50`);

    // Only the service's own signal changes here - `amount` on the host
    // component never does. If MoneyPipe were still a pure pipe, this
    // single detectChanges() (standing in for the CD pass zoneless mode
    // schedules automatically off the back of the signal write) would not
    // be enough to see the masked value: pure pipes skip re-invoking
    // transform() when their bound arguments are unchanged, regardless of
    // what they read internally.
    TestBed.inject(BalanceVisibilityService).toggle();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toBe('••••');
  });
});
