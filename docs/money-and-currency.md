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
`manual_rates`. `get_exchange_rate` resolves a pair in this order:

1. Same currency: `1` without a lookup.
2. The caller's newest manual rate effective on or before the requested date.
3. The inverse of the caller's manual rate.
4. A cached provider rate for today.
5. A live Open Exchange Rates request when `OPENEXCHANGERATES_APP_ID` exists.
6. A flagged 1:1 fallback when no provider key exists or the provider fails.

The provider cache is for today's rate. Manual rates are the only lookup step
that supports an arbitrary historical date. Rates are cached only when both
currency codes exist in the `currencies` table.

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
