/**
 * A user-defined exchange rate for one currency pair, effective from a
 * given date. Lookup takes the newest rate on or before the target date -
 * see data/mock/mock-exchange-rate.repository.ts. Manual rates outrank
 * both the mock `KNOWN_RATES` table and the live provider, matching the
 * real backend's `exchange_rates` table shape (base/quote/rate/as-of) so
 * this ports over unchanged once a backend counterpart exists.
 */
export interface ManualRate {
  id: string;
  baseCode: string;
  quoteCode: string;
  rate: string;
  asOf: string;
}
