import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { provideTranslocoLocale } from '@jsverse/transloco-locale';
import { MoneyPipe } from './money.pipe';

// Intl.NumberFormat separates the currency symbol from the amount with a
// non-breaking space (U+00A0), not a regular space (U+0020). Building the
// expected strings from this constant avoids an invisible-character
// mismatch that would otherwise fail assertions that look correct at a
// glance.
const NBSP = ' ';

describe('MoneyPipe', () => {
  let pipe: MoneyPipe;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: {},
          translocoConfig: { availableLangs: ['pt-BR'], defaultLang: 'pt-BR' }
        })
      ],
      providers: [provideTranslocoLocale({ defaultLocale: 'pt-BR', defaultCurrency: 'BRL' })]
    });
    pipe = TestBed.runInInjectionContext(() => new MoneyPipe());
  });

  it('formats a BRL amount using pt-BR grouping/decimal conventions', () => {
    expect(pipe.transform('1234.5', 'BRL')).toBe(`R$${NBSP}1.234,50`);
  });

  it("uses BRL's 2 decimal digits without a hardcoded default", () => {
    // No fraction-digit option is passed by MoneyPipe — Intl derives 2
    // decimal places from the currency code itself (ISO 4217), which is
    // the point: it isn't hardcoded, so JPY/BHD would format correctly
    // too, with 0 or 3 digits respectively, once supported.
    expect(pipe.transform('10', 'BRL')).toBe(`R$${NBSP}10,00`);
  });
});
