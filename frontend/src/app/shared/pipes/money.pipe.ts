import { inject, Pipe, PipeTransform } from '@angular/core';
import { TranslocoLocaleService } from '@jsverse/transloco-locale';
import { BalanceVisibilityService } from '../../core/balance-visibility.service';

const MASK = '••••';

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
 *
 * `pure: false`: this pipe also reads BalanceVisibilityService.hidden() to
 * mask the amount when the sidebar's eye toggle is off. A *pure* pipe only
 * re-invokes `transform` when its own bound arguments (`amount`,
 * `currencyCode`) change reference between change-detection runs — a
 * signal read inside `transform` isn't one of those arguments, so toggling
 * `hidden` alone would leave every already-rendered amount stale until
 * something else happened to change `amount`/`currencyCode` too. Marking
 * the pipe impure makes Angular call `transform` on every CD pass instead,
 * which is what makes the toggle affect every `| money` in the app
 * immediately (see money.pipe.spec.ts's reactivity test).
 */
@Pipe({ name: 'money', standalone: true, pure: false })
export class MoneyPipe implements PipeTransform {
  private readonly localeService = inject(TranslocoLocaleService);
  private readonly balanceVisibility = inject(BalanceVisibilityService);

  transform(amount: string, currencyCode: string): string {
    if (this.balanceVisibility.hidden()) {
      return MASK;
    }
    return this.localeService.localizeNumber(amount, 'currency', undefined, {
      currency: currencyCode,
      currencyDisplay: 'symbol'
    });
  }
}
