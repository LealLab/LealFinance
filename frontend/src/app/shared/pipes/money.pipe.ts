import { inject, Pipe, PipeTransform } from '@angular/core';
import { TranslocoLocaleService } from '@jsverse/transloco-locale';

/**
 * Formats a monetary amount for display.
 *
 * Built directly on TranslocoLocaleService rather than wrapping
 * TranslocoCurrencyPipe: BaseLocalePipe (which TranslocoCurrencyPipe
 * extends) depends on ChangeDetectorRef, a node-injector-only token that
 * can't be resolved through `inject()` from inside another injectable's
 * constructor. TranslocoLocaleService itself is a plain root-provided
 * service with no such constraint, so it's safe to inject here.
 *
 * Accepts the amount as a *string* to match the API's wire format (see
 * docs/money-and-currency.md — amounts are serialized as JSON strings, not
 * numbers). Note this is a *display-only* guarantee: the formatter below
 * converts through a JS `number` (via Intl.NumberFormat) to render it, same
 * as any currency formatter. That's fine for every realistic balance —
 * float64 is exact well past what any real account holds — but this pipe
 * is not where the NUMERIC(19,4) precision guarantee lives; that's the
 * storage/transport layer (backend Decimal + JSON string).
 *
 * Digit count comes from Intl's per-currency rules, not a hardcoded `2` —
 * JPY, BHD, etc. format correctly once they're added.
 *
 * Usage: {{ '1234.50' | money: 'BRL' }} → "R$ 1.234,50"
 */
@Pipe({ name: 'money', standalone: true })
export class MoneyPipe implements PipeTransform {
  private readonly localeService = inject(TranslocoLocaleService);

  transform(amount: string, currencyCode: string): string {
    return this.localeService.localizeNumber(amount, 'currency', undefined, {
      currency: currencyCode,
      currencyDisplay: 'symbol'
    });
  }
}
