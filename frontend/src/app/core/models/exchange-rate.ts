/**
 * Mirrors the backend's ExchangeRateQuoteRead
 * (backend/app/schemas/currency.py) — field names match the wire format
 * exactly (snake_case): no camelCase alias is configured on the Pydantic
 * side, so this must not "prettify" the names or it'll silently stop
 * matching the real response.
 *
 * `rate` is a string on the wire — see docs/money-and-currency.md for why
 * amounts/rates are never JSON numbers.
 */
export interface ExchangeRateQuote {
  base_code: string;
  quote_code: string;
  rate: string;
  is_fallback: boolean;
  source: string;
  as_of: string;
}
