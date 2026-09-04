import { Component, input, output } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { Button } from '../ui/button/button';

/**
 * Warning banner for a fallback (1:1) exchange rate - see
 * docs/money-and-currency.md. `actionLabelKey` optionally adds a button
 * (e.g. the dashboard sends the user to /exchange to fix it); leave it
 * unset for a plain informational banner, like the transaction form uses.
 *
 *   <app-exchange-rate-warning
 *     [isFallback]="quote.is_fallback"
 *     actionLabelKey="currency.fallbackRateWarningAction"
 *     (action)="goToExchange()"
 *   />
 */
@Component({
  selector: 'app-exchange-rate-warning',
  imports: [TranslocoDirective, Button],
  templateUrl: './exchange-rate-warning.html',
})
export class ExchangeRateWarning {
  isFallback = input(false);
  actionLabelKey = input<string | null>(null);
  action = output<void>();
}
