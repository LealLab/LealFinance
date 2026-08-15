/**
 * A resolved conversion rate between two currencies, in domain-model shape
 * (camelCase) - distinct from core/models/exchange-rate.ts's
 * `ExchangeRateQuote`, which mirrors the *real* backend's snake_case wire
 * format for the live endpoint (GET /api/v1/meta/exchange-rate). The HTTP
 * repository maps that response into this domain shape; mock repositories use
 * the same shape as an in-memory test double.
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
