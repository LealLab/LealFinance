# Money and Currency

Every monetary column and every DTO is built for multi-currency.
So adding a new currency touches only config and data, not the core money-handling code.

## Available in the current UI

- [x] Brazilian Real (`BRL`) - seeded backend currency and default demo-data currency
- [x] US Dollar (`USD`) - default display currency for new users
- [x] Euro (`EUR`) - available as an account currency and exercises the fallback-rate warning
- [x] British Pound (`GBP`) - available as an account currency with mock exchange rates

The backend migration currently seeds BRL only. The other currencies are
available in the frontend scaffold and mock data; persistent multi-currency
domain data will be wired to the API later.

## Planned

- [ ] Mexican Peso (`MXN`)
- [ ] Argentine Peso (`ARS`)
- [ ] Chilean Peso (`CLP`)
- [ ] Colombian Peso (`COP`)
- [ ] Peruvian Sol (`PEN`)
- [ ] Uruguayan Peso (`UYU`)
- [ ] Polish Złoty (`PLN`)
- [ ] Russian Ruble (`RUB`)
- [ ] Ukrainian Hryvnia (`UAH`)
- [ ] Turkish Lira (`TRY`)
- [ ] UAE Dirham (`AED`)
- [ ] Saudi Riyal (`SAR`)
- [ ] Egyptian Pound (`EGP`)
- [ ] Israeli New Shekel (`ILS`)
- [ ] Indian Rupee (`INR`)
- [ ] Chinese Yuan (`CNY`)
- [ ] New Taiwan Dollar (`TWD`)
- [ ] Japanese Yen (`JPY`)
- [ ] South Korean Won (`KRW`)
- [ ] Indonesian Rupiah (`IDR`)
- [ ] Vietnamese Đồng (`VND`)
- [ ] Thai Baht (`THB`)
- [ ] Swedish Krona (`SEK`)
- [ ] Danish Krone (`DKK`)
- [ ] Norwegian Krone (`NOK`)
- [ ] Czech Koruna (`CZK`)
- [ ] Romanian Leu (`RON`)

## The rule: `NUMERIC(19,4)` + a currency code, always

Never a bare amount column. Use the reusable types in `backend/app/models/types.py`:

```python
MoneyAmount = Annotated[Decimal, mapped_column(Numeric(19, 4))]
CurrencyCode = Annotated[str, mapped_column(String(3))]
```

`NUMERIC(19, 4)` - 15 integer digits, 4 decimal places - comfortably covers any realistic balance while keeping sub-unit precision for rates/fees.
Every future money-bearing model should reuse `MoneyAmount`/`CurrencyCode`.

## Python side: `Decimal` end to end, never `float`

No monetary value should ever pass through a Python `float`. `float` is IEEE-754 binary - it cannot represent most decimal fractions exactly, and `NUMERIC(19,4)` values routinely exceed float64's ~15-17 significant digits of precision anyway.

## Wire format: amounts serialize as JSON *strings*

A `NUMERIC(19,4)` value can exceed what a JSON number can carry through a JS `JSON.parse` without silent precision loss (JS numbers are float64 too). Pydantic schemas serialize `Decimal` amounts as strings:

```python
@field_serializer("amount")
def serialize_amount(self, value: Decimal) -> str:
    return str(value)
```

See `backend/app/schemas/currency.py` (`ExchangeRateRead`) for the pattern, and `backend/tests/test_money_precision.py` for the test that actually proves a 15-digit amount round-trips through Postgres → Python → JSON without losing a digit.

## Display formatting is a *separate* guarantee - and it's float64-based

`frontend/src/app/shared/pipes/money.pipe.ts` (`MoneyPipe`) formats amounts for the UI via `TranslocoLocaleService`, which under the hood converts through `Intl.NumberFormat`, and that converts through a JS `number`.
This is completely standard for currency *display* and fine for every realistic balance (float64 is exact far beyond what any real account holds), but it's worth being precise about what's guaranteed where:

- **Storage/transport** (Postgres `NUMERIC` + the JSON-string wire format): exact, arbitrary precision within the column's bounds.
- **Display** (`MoneyPipe`): float64-precision formatting, same as any standard currency formatter. Don't reach for `MoneyPipe` (or anything Intl-based) anywhere precision actually needs to survive - that's the backend's job.

## Rounding

Display rounding uses the currency's own decimal digit count (`Intl` derives this from the ISO 4217 currency code - JPY gets 0, BHD gets 3), never a hardcoded `2`. Rounding happens only at presentation or settlement time, never mid-calculation.

## Multi-currency scaffolding that already exists

Two reference tables, seeded with BRL only
(`backend/alembic/versions/b0b0888983a8_baseline_currencies_and_exchange_rates.py`):

- `currencies` - code (ISO 4217), name, symbol, decimal digits, active flag.
- `exchange_rates` - base/quote code, rate, as-of date, source. Ships **empty**, populated lazily by the conversion service below as pairs are actually requested (not pre-seeded).

## Automatic currency conversion

`backend/app/services/exchange_rates.py` (`get_exchange_rate(db, base, quote)`) fetches a conversion rate **on demand** - not on a schedule - and caches it in `exchange_rates` for the rest of the day:

1. Same currency → `1`, always, no lookup.
2. A cached rate for today already exists → returned as-is, no network call.
3. `OPENEXCHANGERATES_APP_ID` isn't set → **1:1 fallback**, flagged `is_fallback=True`. Nothing is cached (so setting a key later takes effect immediately, same day, without a stale fallback row in the way).
4. Otherwise, fetch from [Open Exchange Rates](https://openexchangerates.org/) and cache the result (`source="openexchangerates"`).

   The free plan only allows `base=USD` - changing the base currency requires a paid plan - so non-USD pairs are computed via a USD bridge in a single request: `rate(A→B) = rates[B] / rates[A]`, where `rates[X]` is "how many X per 1 USD."

5. If the provider call fails for any reason, same 1:1 fallback as (3) rather than propagating the error - a broken exchange-rate lookup should never be why a request fails.

A currency pair is only cached if *both* codes already exist in `currencies` (`exchange_rates` has a foreign key to it) - an unrecognized code still gets a computed/fallback rate returned, it just isn't persisted.

`ExchangeRateQuoteRead` (`backend/app/schemas/currency.py`) is the response shape, exposed at `GET /api/v1/meta/exchange-rate?base=...&quote=...` - `rate` as a string per the wire-format rule above, plus `is_fallback` and `source` so a caller can decide whether to show a warning.

**Not yet wired to anything that creates a transaction** - there is no transactions domain in this scaffold yet (see the last section). This service is what that flow is expected to call once it exists; the scheduled-refresh Celery task (`backend/app/workers/tasks/rates.py`, `refresh_exchange_rates`) is unrelated and still disabled - on-demand lookup is the actual design here, not a batch job.

## What doesn't exist yet

No accounts, transactions, or balances - this scaffold has no domain model, only the currency reference tables and the conversion service above. When that model gets built, every balance/amount column should use `MoneyAmount` + `CurrencyCode` from day one, and transaction creation in a non-default currency is where `get_exchange_rate` should be called.
