# Investments

Investments are optional and can be enabled per user from Settings. The
feature tracks wallets, assets, and the transactions that make up each
position while keeping ordinary cash accounts in the main ledger.

## Domain

A wallet is a named portfolio in one currency and owns a corresponding
investment account. It can optionally link to a cash account for buy and sell
settlement. An asset is a user-owned symbol such as a stock, fund, or crypto
asset, with its own currency and either a manual price or a live quote
provider. A transaction is a dated buy, sell, dividend, or fee recorded in the
wallet's currency.

Positions are derived from the transaction ledger with average-cost accounting.
Buys add quantity and cost (including fees); sells remove quantity at the
current average cost and record the difference between proceeds and that cost;
dividends and fees are tracked separately. The server derives a buy or sell's
amount from `quantity * price`, and edits or deletes are checked by re-folding
the affected ledger so a later sale cannot leave the position invalid.

When a wallet has a cash account, buy and sell events create these optional
ledger transfers:

| Investment event | Transfer direction | Transfer amount |
| --- | --- | --- |
| Buy | Cash account → investment account | `quantity * price + fee` |
| Sell | Investment account → cash account | `quantity * price - fee` |

The cash account and wallet may use different currencies. In that case the
normal exchange-rate service performs the conversion and marks a 1:1 fallback
so the UI can show its warning.

## Quotes

Each position resolves a price with this precedence:

1. The asset's manual price, or any asset configured with the manual provider.
2. A quote already cached for today.
3. One batched live request for each provider used by the wallet's positions.
4. The newest cached quote for the symbol, marked stale.
5. No price, also marked stale.

Live quotes use Twelve Data's quote endpoint or brapi's quote endpoint. A
provider failure is logged and swallowed, so the positions and summary pages
continue with the cache, a stale quote, or a null market value.

## Credentials

Credential resolution is user row → instance `.env` → none. Users can link or
clear their own API keys in Settings; the stored value is encrypted with the
same `API_SECRET_KEY`-derived encryption used for other readable secrets, and
status responses never include the key itself. Instance administrators can
provide optional fallbacks with `TWELVE_DATA_API_KEY` and `BRAPI_TOKEN`.

Manual prices remain fully supported when neither a user key nor an instance
fallback is configured.
