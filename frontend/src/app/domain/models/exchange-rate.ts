/**
 * A resolved conversion rate between two currencies, in domain-model shape
 * (camelCase) - distinct from core/models/exchange-rate.ts's
 * `ExchangeRateQuote`, which mirrors the *real* backend's snake_case wire
 * format for the one live endpoint this scaffold has
 * (GET /api/v1/meta/exchange-rate). This app is UI-only for now - nothing
 * calls that live endpoint from the money screens - so the mock data
 * layer (data/exchange-rate.repository.ts) works with this shape instead.
 */
export interface ExchangeRate {
  baseCode: string;
  quoteCode: string;
  rate: string;
  isFallback: boolean;
  source: 'manual' | 'quote' | 'fallback';
  /** Effective date used by the rate resolver, preserved as an ISO date. */
  asOf: string;
}
