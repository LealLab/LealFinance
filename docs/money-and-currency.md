# Money and currency

LealFinance supports multiple currencies throughout storage, the API, and the
frontend. Currency data is seeded by the backend migrations; the `currencies`
table is the source of truth for active codes, names, symbols, and decimal
digits.

## Storage and API rules

Every monetary value uses an amount and a currency code:

```python
MoneyAmount = Annotated[Decimal, mapped_column(Numeric(19, 4))]
CurrencyCode = Annotated[str, mapped_column(String(3))]
```

- Use `NUMERIC(19,4)` for monetary database columns.
- Use Python `Decimal` end to end. Never convert money to `float` for storage
  or calculations.
- Serialize amounts and rates as JSON strings so JavaScript cannot silently
  lose decimal precision.
- Display rounding uses the currency's ISO 4217 decimal-digit count, not a
  hardcoded two decimal places.

The frontend may use standard `Intl.NumberFormat` conversion for display. Any
calculation that must preserve precision belongs in the backend or in the
string-based frontend money helpers, not in a display formatter.

## Exchange-rate lookup

The backend stores provider rates in `exchange_rates` and user overrides in
`manual_rates`. `get_exchange_rate` is a pure read; it resolves a pair for a
given date in this order:

1. Same currency: `1` without a lookup.
2. The caller's newest manual rate effective on or before the requested date.
3. The inverse of the caller's manual rate.
4. A cached rate for that date - a directly stored pair, or a USD bridge
   (`quote / base`) built from the USD-anchored rows the refresh writes.
5. A flagged 1:1 fallback - no key, no scheduled refresh yet, or the
   provider failed.

The Open Exchange Rates free plan quotes only against USD, refreshes hourly,
and caps usage at 1,000 requests/month, so the cache is USD-anchored: one
request (`latest.json`, or `historical/{date}.json` for a past date - no
`symbols`, which is paid-only there) stores one `USD -> X` row per known
currency, and every pair is a local division. Rows are written only for
currency codes that exist in the `currencies` table.

The cache is filled by writes, never by a lookup:

- A Celery beat task (`refresh_exchange_rates`) refreshes today's rates
  every six hours.
- `warm_cache_for` runs when an account is created or changed to a foreign
  currency, so its balances convert against a real rate without waiting for
  the next scheduled refresh.

A nightly Celery task (`backfill_fallback_conversions`) re-resolves
transactions whose conversion was recorded at the 1:1 fallback before a key
existed, using the rate that applied on each transaction's own date. It is
bounded per run so a long history cannot exhaust the monthly quota.

`GET /api/v1/meta/exchange-rate` returns the rate as a string plus `source` and
`is_fallback`. The endpoint is authenticated because manual rates belong to
the caller.

## Recorded conversions

A cross-currency transaction records the destination amount, destination
currency, rate, fee, and source. The server validates the relationship before
saving it:

```text
converted amount = (transaction amount - fee) * rate
```

The fee is in the transaction's origin currency and cannot exceed the amount.
The origin account still records the full transaction amount; the fee is the
part that does not reach the destination. Same-currency transactions must not
include a conversion object.

The server rechecks the currency, fee, and multiplication with destination
currency rounding tolerance. Once saved, the recorded conversion is
authoritative; later reads do not recalculate it from a live rate.

Recurring-rule templates use the same conversion validation. When a recurring
occurrence is posted, it resolves the rate for that occurrence instead of
replaying an old template rate.

## Manual rates and fallback warnings

Users can set an effective-date override with:

```text
PUT /api/v1/manual-rates/{pair}/{date}
```

For example, `USD_BRL` and `2026-01-15` with a body such as
`{"rate":"5.20"}`. Manual rates take precedence over cached and live provider
rates for that user.

A missing provider rate produces a 1:1 result marked as a fallback. The UI can
show that warning for converted transactions and for account or goal display
values that have no usable rate yet.

See [`backend-api.md`](backend-api.md#exchange-rates-and-manual-rates) for
endpoint contracts and [`architecture.md`](architecture.md) for the data flow.
