import { Component, input } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';

/**
 * Warning banner for a fallback (1:1) exchange rate - see
 * docs/money-and-currency.md. Not yet used anywhere: there's no
 * transaction UI in this scaffold to attach it to. Intended usage, once
 * that exists:
 *
 *   <app-exchange-rate-warning [isFallback]="quote.is_fallback" />
 */
@Component({
  selector: 'app-exchange-rate-warning',
  imports: [TranslocoDirective],
  templateUrl: './exchange-rate-warning.html',
  styleUrl: './exchange-rate-warning.scss'
})
export class ExchangeRateWarning {
  isFallback = input(false);
}
