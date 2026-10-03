# Investments

Investments are optional and can be enabled per user from Settings. The
feature tracks wallets, assets, and the transactions that make up each
position while keeping ordinary cash accounts in the main ledger.

## Domain

A wallet is a named portfolio in one currency and owns a corresponding
investment account. It can optionally link to a cash account for buy and sell
settlement. An asset is a user-owned symbol such as a stock, fund, or crypto
asset, with its own currency and either a manual price or a live quote
provider. A transaction is a dated buy, sell, dividend, fee, or yield recorded
in the wallet's currency. The transaction menu sits in the wallet's Transactions
view, including its empty state; New asset sits in the Assets view. Each
transaction type opens its own fixed-type form. The `?new` wallet shortcut
opens the transaction menu.

Positions are derived from the transaction ledger with average-cost accounting.
Buys add quantity and cost (including fees); sells remove quantity at the
current average cost and record the difference between proceeds and that cost;
dividends and fees are tracked separately. A yield credits the held position
without adding units or changing its book value. Its outstanding balance is
included in market value and decreases proportionally when units are sold.
Editing or deleting a yield recalculates the position from the ledger. The
server derives a buy or sell's amount from `quantity * price`, and edits or
deletes are checked by re-folding the affected ledger so a later sale cannot
leave the position invalid.

A buy may instead be entered by amount spent: omit `quantity` and `price` and
send `amount` as the gross amount paid, fee included. The server resolves the
quantity from the asset's price on that date, subtracts the fee first, and
stores `amount` as `quantity * price` like any other buy. Updating a stored
buy with `amount` alone (no `quantity` or `price` in the same patch) reprices
it the same way; sending `amount` together with `quantity` or `price` has no
effect, since `amount` is always re-derived from them.

Record a yield by sending `type: "yield"`, an asset, date, and positive `amount`
in the wallet's currency. The asset must have a configured manual price and
units already held on that date. Yields have no quantity, unit price, fee, or
cash-account transfer. Enter each yield amount manually; the application does
not calculate interest rates. The manual price represents the asset's base
value before recorded yields, avoiding double counting. Position responses
expose the outstanding amount as `yield_balance`.

When a wallet has a cash account, buy and sell events create these optional
ledger transfers:

| Investment event | Transfer direction | Transfer amount |
| --- | --- | --- |
| Buy | Cash account → investment account | `quantity * price + fee` |
| Sell | Investment account → cash account | `quantity * price - fee` |

The cash account and wallet may use different currencies. In that case the
normal exchange-rate service performs the conversion and marks a 1:1 fallback
so the UI can show its warning.

### Existing positions

Assets you already held before using LealFinance would otherwise debit the cash
account when you record them, driving it negative. Tick **Existing position**
(with the `?` help next to it) on a new buy in a wallet that has a cash account,
or send `existing_position: true`, to avoid that. No transfer is posted and the
cash account is untouched. The wallet's investment account balance still
includes `quantity * price + fee`, so net worth counts the position.

The option applies to buys only and is fixed when the buy is created. To change
it, delete the buy and record it again. Deleting it, or editing its quantity or
price, updates the investment account balance. Existing-position buys cannot yet
be cleared in an account reconciliation, since they have no ledger row.

## Quotes

Each position resolves a price with this precedence:

1. The asset's manual price, or any asset configured with the manual provider.
2. A quote already cached for today.
3. One batched live request for each provider used by the wallet's positions.
4. The newest cached quote for the symbol, marked stale.
5. No price, also marked stale.

Live quotes use Twelve Data's quote endpoint, brapi's quote endpoint, or
CoinGecko's `/coins/markets` endpoint. A crypto asset created with the default
`manual` provider is switched to `coingecko` automatically, the same way a B3
ticker (e.g. `PETR4`) is switched to `brapi`. A provider failure is logged and
swallowed, so the positions and summary pages continue with the cache, a
stale quote, or a null market value. The quote cache is keyed by provider,
symbol, currency, and date, keeping crypto and equity tickers separate.
The same symbol held in two different wallet
currencies (e.g. BTC priced in both USD and BRL) is cached and served
independently per currency.

## Credentials

Credential resolution is user row → instance `.env` → none. Users can link or
clear their own API keys in Settings; the stored value is encrypted with the
same `API_SECRET_KEY`-derived encryption used for other readable secrets, and
status responses never include the key itself. Instance administrators can
provide optional fallbacks with `TWELVE_DATA_API_KEY` and `BRAPI_TOKEN`.
CoinGecko is the exception: its public API needs no key at all, so crypto
assets price automatically even with nothing configured. An optional
`COINGECKO_API_KEY` only raises the provider's rate limit.

Manual prices remain fully supported when neither a user key nor an instance
fallback is configured.
