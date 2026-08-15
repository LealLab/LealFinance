# Money and Currency

Every monetary column and every DTO is built for multi-currency.
So adding a new currency touches only config and data, not the core money-handling code.

## Available in the current UI

- [x] Brazilian Real (`BRL`) - seeded backend currency, default demo-data currency,
  and default persisted display currency for new users
- [x] US Dollar (`USD`) - seeded backend currency and frontend pre-auth display fallback
- [x] Euro (`EUR`) - seeded backend currency and available as an account currency
- [x] British Pound (`GBP`) - seeded backend currency and available as an account currency

The migrations seed BRL, USD, EUR, and GBP. The frontend's HTTP repositories
use the persistent API domain; mock data remains available for tests and local
test doubles.

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

Reference tables, seeded with BRL, USD, EUR, and GBP
(`backend/alembic/versions/b0b0888983a8_baseline_currencies_and_exchange_rates.py`
plus `backend/alembic/versions/47379d62fa35_seed_usd_eur_gbp_currencies.py`):

- `currencies` - code (ISO 4217), name, symbol, decimal digits, active flag.
- `exchange_rates` - the **provider rate cache**: base/quote code, rate, as-of date, source. Ships empty, populated lazily as pairs are actually requested. Global, not user-owned - one cached rate per pair per day serves every user.
- `manual_rates` - **user-owned** overrides: one `{base_code, quote_code, rate, as_of}` per pair per effective date per user. See "Manual rates" below.

## Automatic currency conversion

`backend/app/services/exchange_rates.py` (`get_exchange_rate(db, base, quote, *, user_id=None, as_of=None)`) resolves a rate through this precedence:

1. Same currency → `1`, always, no lookup.
2. The caller's manual rate effective on or before `as_of` (defaults to today) - the newest such rate wins. Only consulted when `user_id` is passed.
3. The inverse of the caller's manual rate for the reversed pair, same effective-date rule.
4. A cached provider rate for **today** already exists → returned as-is, no network call. (The provider cache is always "today's rate" - manual rates are the only precedence step that supports an arbitrary historical `as_of`.)
5. `OPENEXCHANGERATES_APP_ID` isn't set → **1:1 fallback**, flagged `is_fallback=True`. Nothing is cached (so setting a key later takes effect immediately, same day, without a stale fallback row in the way).
6. Otherwise, fetch from [Open Exchange Rates](https://openexchangerates.org/) and cache the result (`source="openexchangerates"`).

   The free plan only allows `base=USD` - changing the base currency requires a paid plan - so non-USD pairs are computed via a USD bridge in a single request: `rate(A→B) = rates[B] / rates[A]`, where `rates[X]` is "how many X per 1 USD."

7. If the provider call fails for any reason, same 1:1 fallback as (5) rather than propagating the error - a broken exchange-rate lookup should never be why a request fails.

A currency pair is only cached if *both* codes already exist in `currencies` (`exchange_rates` has a foreign key to it) - an unrecognized code still gets a computed/fallback rate returned, it just isn't persisted.

`ExchangeRateQuoteRead` (`backend/app/schemas/currency.py`) is the response shape, exposed at `GET /api/v1/meta/exchange-rate?base=...&quote=...&as_of=...` - `rate` as a string per the wire-format rule above, plus `is_fallback` and `source` so a caller can decide whether to show a warning. This endpoint is authenticated (unlike `/meta/currencies` and `/meta/settings`), since resolution now consults the caller's own manual rates.

Called from transaction creation/update (`backend/app/services/conversion.py`, see below) and from `POST/PATCH /api/v1/recurring-rules` for a rule's template. The scheduled-refresh Celery task (`backend/app/workers/tasks/rates.py`, `refresh_exchange_rates`) is unrelated and still disabled - on-demand lookup is the actual design here, not a batch job.

## Recorded conversions

Transactions record a conversion in five `conversion_*` columns
(`backend/app/models/transaction.py`) - flat columns, not JSONB, so the
destination currency still gets a real foreign key, the amount/rate still
get real `NUMERIC` typing and CHECK constraints, and they can't silently
drift from the money rules above. `Transaction.conversion` is a read-only
`@property` that exposes them as the nested object the frontend expects:

```ts
interface TransactionConversion {
  amount: string;   // what posted to the destination account
  currency: string;
  fee?: string;      // tax/spread, in the ORIGIN currency
  rate: string;       // amount ÷ (Transaction.amount − fee)
  source: 'manual' | 'quote' | 'fallback';
}
```

A transaction is cross-currency in one of two ways: a transfer between two
accounts of different currencies, or an income/expense/interest denominated
in a currency other than its account's own. Either way, `conversion` records
what actually happened on the *destination* side - the account whose
currency differs from `Transaction.currency`.

The fee is deducted **before** conversion, in the transaction's own (origin)
currency - `converted = (amount − fee) × rate` - and the origin account is
still debited the full `Transaction.amount`; the fee is the slice of it that
didn't make it across, not an extra charge on top. `backend/app/services/conversion.py::resolve_conversion` **recomputes and validates** this arithmetic server-side rather than trusting the client blindly: currency, fee-not-exceeding-amount, and the multiplication are all re-checked (rounded to the destination currency's own `decimal_digits`, with a one-ULP tolerance for the client's own rounding), and a mismatch is rejected with `transaction.conversion_mismatch`. If the client omits `conversion.amount`, the server fills it in. `source` is stored exactly as sent, including `'fallback'` - it is never silently upgraded to `'quote'`.

On the frontend, see `features/transactions/conversion-form.ts` for how the
form builds this payload and `domain/calc/conversion.ts` for the read-side
helpers every balance/total calculation uses instead of touching
`amount`/`currency` directly.

Once a transaction is saved, its recorded `conversion` is authoritative -
nothing re-derives it from a live rate afterward, on either side. This is
about *later reads*, though, not a license to skip validating the arithmetic
at write time (see above). `source: 'fallback'` means it was saved with a
1:1 approximation; those are the Exchange page's ("Câmbio" in pt-BR) "needs
attention" queue - `GET /api/v1/transactions?type=...` plus a client-side
filter on `conversion.source === 'fallback'` today; there is no dedicated
server-side query for it yet.

Recurring rules mirror the same shape for their `template` (`template_conversion_*` columns, `RecurringRule.template_conversion` and `.template` properties) and are validated with the exact same `resolve_conversion`/`validate_transaction_shape` functions a real transaction uses - one source of truth for the invariant, not two copies that can drift.

**Manual rates** (`PUT /api/v1/manual-rates/{pair}/{date}`, e.g. `PUT /api/v1/manual-rates/USD_BRL/2026-01-15`, body `{"rate": "5.20"}`) let a user override the automatic rate - useful for today's actual bank rate, or when no provider is configured. Uniqueness is scoped by user, base currency, quote currency, and effective date (`uq_manual_rates_user_pair_as_of`). They outrank both the cached provider rate and a live provider quote when resolving a conversion - see the precedence list above - matching how `frontend/src/app/data/mock/mock-exchange-rate.repository.ts` already prioritizes them today.

**Coverage gaps aren't only a transaction thing.** An account balance or
goal amount can be shown as a 1:1 approximation purely because no rate
covers its currency yet, with no transaction involved at all - e.g. an
account holds EUR, the display currency is USD, and nothing has ever set
a EUR/USD rate. `features/exchange/exchange.ts`'s "Currencies without a
rate" section detects this directly (fetching a live quote per
foreign-currency account and checking `isFallback`), separately from the
transaction-level "needs attention" list above, and its "Set a rate"
action opens the manual-rate form pre-filled with that pair.

**Converted-value display.** Accounts (list and detail) and Goals show
the display-currency equivalent next to a foreign-currency amount - `€
2.000,00 (US$ 2.000,00)` - using the same rate resolution as the dashboard's
net worth figure. In production, the HTTP exchange-rate repository requests
`GET /api/v1/meta/exchange-rate`, which applies the manual-rate, cached
provider, live-provider, and flagged 1:1 fallback precedence described above;
manual-rate changes use `/api/v1/manual-rates`. Tests that inject mock
repositories use an equivalent in-memory table. `domain/calc/aggregations.ts`'s
`converterFromRates` (turns
a batch of fetched `ExchangeRate`s into a `CurrencyConverter`) and
`convertedOrNull` (only returns a value when conversion actually changed
the currency) are the shared helpers behind this - reused by
`dashboard.ts`, `exchange.ts`, `accounts.ts`, `account-detail.ts`, and
`goals.ts` rather than each page re-deriving its own rate map.

## Frontend integration status

The backend domain model, transaction conversion validation, manual rates, and
the HTTP-backed frontend repositories are implemented (see
[`backend-api.md`](backend-api.md) for the full endpoint list). The frontend
maps the backend's snake_case wire format into camelCase domain models. Mock
repositories still provide an in-memory test double with equivalent rate
precedence, but they are not the production providers.
