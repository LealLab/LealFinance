import { computed, inject, Signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { forkJoin, Observable, of } from 'rxjs';
import { DisplayCurrencyService } from '../../core/display-currency.service';
import { pairsCovered, converterFromRates, CurrencyConverter } from '../../domain/calc/aggregations';
import { ExchangeRate } from '../../domain/models/exchange-rate';
import { ExchangeRateRepository } from '../../data/exchange-rate.repository';

export interface RatesConverter {
  /**
   * `null` until every pair named by the caller has a fetched rate - see
   * `pairsCovered`. Every screen must treat `null` as "can't aggregate
   * yet" (skip the computation, show a loading state) rather than falling
   * back to `converterFromRates([])`'s unconverted passthrough, which is
   * what threw `Currency mismatch` on the dashboard's first render.
   */
  readonly converter: Signal<CurrencyConverter | null>;
  readonly hasFallbackRate: Signal<boolean>;
  /** Re-fetches every rate - call after an action that can change what a rate resolves to (e.g. saving a manual rate), same params or not. */
  readonly reload: () => void;
}

/**
 * Fetches one rate per `[source, target]` pair `pairs()` names and exposes
 * a converter that's `null` until they've all arrived. Call from a field
 * initializer (an injection context) - see `openOnNewParam` for the same
 * pattern. The general form behind `displayConverter` below: most screens
 * only ever need "every foreign currency converted into one display
 * currency" (a single target), but a couple - budgets.ts's planner, and
 * the dashboard's budget-preview card - convert into each *budget's own*
 * currency instead, which can differ both from the display currency and
 * from each other, so they need arbitrary pairs.
 */
export function pairsConverter(pairs: () => readonly (readonly [string, string])[]): RatesConverter {
  const exchangeRateRepository = inject(ExchangeRateRepository);

  const ratesResource = rxResource({
    params: () => pairs(),
    stream: ({ params }): Observable<ExchangeRate[]> => {
      if (params.length === 0) return of([]);
      return forkJoin(params.map(([base, quote]) => exchangeRateRepository.getRate(base, quote)));
    }
  });

  const rates = computed(() => ratesResource.value() ?? []);

  const converter = computed<CurrencyConverter | null>(() =>
    pairsCovered(rates(), pairs()) ? converterFromRates(rates()) : null
  );

  const hasFallbackRate = computed(() => rates().some((rate) => rate.isFallback));

  return { converter, hasFallbackRate, reload: () => ratesResource.reload() };
}

/**
 * `pairsConverter` for the common case: every currency in `currencies()`
 * converted into one shared display currency. Replaces the
 * foreignCurrencies/exchangeRatesResource/converter triple that used to be
 * copy-pasted into every money-aggregating screen (dashboard, accounts,
 * budgets, categories, goals, reports, exchange).
 */
export function displayConverter(currencies: () => readonly string[]): RatesConverter {
  const displayCurrency = inject(DisplayCurrencyService).currency;
  return pairsConverter(() => currencies().map((currency) => [currency, displayCurrency()] as const));
}
