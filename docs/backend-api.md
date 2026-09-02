# Backend API

This is the canonical reference for endpoints, ownership rules, error codes,
and first-admin bootstrap. See [`architecture.md`](architecture.md) for
service topology and [`money-and-currency.md`](money-and-currency.md) for
money and conversion rules.

## Conventions

- All routes are versioned under `/api/v1`.
- Wire format is snake_case, matching the ORM/schema field names exactly -
  there is no camelCase alias generator. The frontend's domain models are
  camelCase and its HTTP repositories map them to this wire format.
- UUIDs serialize as strings. Decimal amounts and rates serialize as JSON
  **strings**, never numbers (see `money-and-currency.md`).
- Every error response uses one envelope, regardless of source (a domain
  `AppError`, a Pydantic validation failure, or a bare Starlette
  `HTTPException`):

  ```json
  { "error": { "code": "account.not_found", "params": { "id": "..." } } }
  ```

  `code` is a stable, machine-readable string - a Transloco key suffix on
  the frontend, never a translated message. Validation failures use
  `error.validation` with `params.errors` holding FastAPI's per-field error
  list.
- Every route except `/health/*`, `/meta/currencies`, `/meta/settings`,
  `/auth/login`, `/auth/register`, and `/auth/setup-status` requires an
  authenticated session (`auth.unauthenticated`, 401, if the session cookie
  is missing or invalid).
- Every route scoped to a single resource (`GET/PATCH/DELETE .../{id}`)
  returns `404` with a domain-specific `*.not_found` code for an id that
  either doesn't exist or belongs to another user - never `403`. A `403`
  would confirm the id exists at all, which is an enumeration oracle across
  other users' data. See `app/services/ownership.py`.
- Authenticated state-changing requests (anything but `GET`/`HEAD`/`OPTIONS`)
  need the `X-XSRF-TOKEN` header set to the value of the readable `XSRF-TOKEN`
  cookie issued at login. The public `/auth/login` and `/auth/register`
  endpoints are the only state-changing exceptions. See "Sessions and CSRF"
  below. Angular's `HttpClient` does this automatically by default; nothing
  extra is needed on the frontend once it talks to this API for real.

## Bootstrap and identity

Registration is invite-only, except the very first user on an instance.

1. **First admin**: while the `users` table is empty, `POST /auth/register`
   accepts a request with no `token` field and creates that user with
   `role=admin`. `GET /auth/setup-status` (public) returns
   `{"needs_setup": true}` until that happens, so the frontend can hide the
   invitation-token field for the very first registration. Once any user
   exists, a token-less register is rejected with `invitation.not_found`,
   the same code an unknown/wrong token gets.
2. **Invite everyone else**: an admin calls `POST /auth/invitations`; the
   response includes the raw, one-time invitation token - the only time it
   is ever exposed. Delivery is out-of-band (no email provider in v1).
3. **Register**: the invitee calls `POST /auth/register` with their email,
   the token, and their own password. Admins never create or see member
   passwords. A successful register also logs the new user in (same cookies
   as `/auth/login`).

### Sessions and CSRF

- `POST /auth/login` / `/auth/register` set two cookies: `lf_session`
  (opaque token, `HttpOnly`, `SameSite=Lax`, `Secure` in production) and
  `XSRF-TOKEN` (same flags except **not** `HttpOnly` - JS must be able to
  read it). Only a keyed hash (HMAC-SHA256, keyed by `API_SECRET_KEY`) of
  each token is ever stored; rotating `API_SECRET_KEY` invalidates every
  session and pending invitation.
- The CSRF check is folded directly into the same dependency that resolves
  the session (`app/api/deps.py::get_current_session`), not offered as a
  separate opt-in dependency - a route can't forget it. It compares a
  keyed hash of the `X-XSRF-TOKEN` header against the session's own stored
  hash, not just cookie-equals-header, so a forged pair from another origin
  can't validate even if the session cookie's format is guessed.
- `POST /auth/logout` revokes the current session and clears both cookies.

### Two-factor authentication (optional, per user)

- Enrollment is `POST /auth/totp/setup` (returns a base32 secret plus its
  `otpauth://` URI) then `POST /auth/totp/enable` with a working code. Only
  the second step arms anything: the secret is stored encrypted
  (`app/core/crypto.py`) from the first, but `totp_confirmed_at` is what
  gates a login. Enabling returns ten single-use backup codes, shown once
  and stored only as keyed hashes - there is no endpoint that lists them
  again, only `POST /auth/totp/backup-codes` to replace the set.
- `POST /auth/totp/disable` requires a current code, so a stolen session
  can't quietly strip the second factor.
- Login is one endpoint in two phases. `POST /auth/login` answers `401
  auth.totp_required` when the account has TOTP on and the request carries
  no valid `lf_trust` cookie; the client resubmits the same body with
  `totp_code` (a TOTP code or a backup code) and optionally
  `trust_device: true`. There is deliberately no challenge token and no
  pending-login state to expire or clean up. The challenge is raised only
  after the password and active checks pass, so it never reveals which
  accounts exist or which have a second factor.
- `trust_device` is opt-in per login. When set, the response also carries
  `lf_trust` (opaque, `HttpOnly`, `TRUSTED_DEVICE_TTL_DAYS`, default 30),
  and that browser skips the challenge until it expires. Without the flag
  every sign-in is challenged.
- A TOTP code is burned once used: `users.totp_last_step` is the floor, so
  the same six digits can't be replayed inside their own window. Five
  consecutive bad codes lock the second factor for 15 minutes. That counter
  is the only rate limiting in the API, and every code-accepting path shares
  one verify function so none of them can bypass it.
- `POST /auth/recover` (public, like `/login`) takes `email`, `code`, and
  `new_password`, and returns 204. It issues no session; it revokes every
  session and every trusted device for the user, and burns the code it used.
  An unknown address, a deactivated account, a user without TOTP, and a wrong
  code all return the same `auth.invalid_credentials`, so recovery can't be
  used to enumerate accounts.

### Auth error codes

| Code | Status | When |
| --- | --- | --- |
| `auth.unauthenticated` | 401 | No session cookie, or the resolved user is missing. |
| `auth.session_invalid` | 401 | Cookie present but expired, revoked, or unknown. |
| `auth.invalid_credentials` | 401 | Wrong email/password at login (indistinguishable timing from an unknown email). |
| `auth.account_inactive` | 401 | Valid credentials/session, but the account is deactivated. |
| `auth.totp_required` | 401 | Password accepted, but the account has TOTP enabled and this browser isn't trusted. Retry `POST /auth/login` with `totp_code`. |
| `auth.totp_invalid` | 401 | Wrong, expired, or already-used second factor. |
| `auth.totp_locked` | 401 | Five consecutive bad codes; further attempts are refused for 15 minutes. |
| `totp.already_enabled` | 409 | Enrollment started on an account that already has TOTP confirmed. |
| `totp.not_enabled` | 409 | Disable/regenerate called on an account without confirmed TOTP. |
| `auth.csrf_invalid` | 403 | State-changing request with a missing/mismatched `X-XSRF-TOKEN`. |
| `auth.forbidden` | 403 | Generic authorization failure. |
| `auth.admin_required` | 403 | Non-admin called an admin-only route. |
| `auth.peer_admin` | 403 | An administrator tried to change another administrator's role or active state. |
| `auth.last_admin` | 409 | Attempt to demote or deactivate the only remaining admin. |
| `auth.invalid_role` | 422 | Role isn't `admin` or `member`. |
| `auth.invalid_theme` | 422 | Theme preference isn't `light` or `dark`. |
| `user.not_found` | 404 | An administrator tried to update a user id that doesn't exist. |
| `invitation.not_found` | 404 | Token doesn't exist, or the email doesn't match the token's invitation (deliberately the same code for both - see "email mismatch" in the phase's test suite). |
| `invitation.revoked` | 409 | Invitation was revoked before being accepted. |
| `invitation.already_accepted` | 409 | Token already used (single-use). |
| `invitation.expired` | 409 | Past `expires_at`. |
| `invitation.already_pending` | 409 | An unexpired, unrevoked, unaccepted invitation already exists for that email. |
| `user.email_taken` | 409 | Registering/inviting an email that already has an account. |

## Endpoints

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/health/live` | public | Process liveness only. |
| GET | `/health/ready` | public | 503 unless both Postgres and Redis are reachable. |
| GET | `/meta/currencies` | public | Active currencies only. |
| GET | `/meta/settings` | public | `default_currency`, `default_locale`, and boolean `agents_enabled`. |
| GET | `/meta/exchange-rate?base=&quote=&as_of=` | user | See "Exchange rates" below. |
| POST | `/meta/exchange-rates/refresh` | admin | Force a provider refresh of today's rates; cooldown-gated. See "Exchange rates" below. |
| GET | `/meta/update-status` | admin | Current/latest version and whether an update is available; see "Updates" below. |
| POST | `/auth/invitations` | admin | Body `{email, role}`. Returns the raw token once. |
| GET | `/auth/invitations` | admin | Never includes the token. |
| DELETE | `/auth/invitations/{id}` | admin | Revoke. |
| POST | `/auth/register` | public | Body `{email, token, password, display_name, base_currency?}`. Logs in on success; the selected base currency also initializes display currency. |
| POST | `/auth/login` | public | Body `{email, password}`. |
| POST | `/auth/logout` | user | 204. |
| GET | `/auth/me` | user | |
| GET | `/auth/users` | admin | |
| PATCH | `/auth/users/{id}` | admin | `{role?, is_active?, display_name?}`. |
| GET/PATCH | `/auth/preferences` | user | `{locale, theme, base_currency, display_currency, balances_hidden}` - stored as columns on `users`, not localStorage; only display currency is changeable here. |
| GET/POST | `/institutions` | user | |
| GET/PATCH | `/institutions/{id}` | user | |
| POST | `/institutions/{id}/archive` | user | Body `{archived}`. |
| DELETE | `/institutions/{id}` | user | Blocked while any account references it (409). |
| GET/POST | `/accounts` | user | No delete - archive only. |
| GET | `/accounts/balances?as_of=` | user | Server-computed balance per owned account. `as_of` (inclusive ISO date) restricts the ledger to on/before that date. |
| GET/PATCH | `/accounts/{id}` | user | |
| POST | `/accounts/{id}/archive` | user | Body `{archived}`. |
| GET/POST | `/categories` | user | `position` is server-assigned on create. |
| PATCH | `/categories/{id}` | user | |
| DELETE | `/categories/{id}` | user | Blocked while referenced by transactions or recurring templates (409). |
| GET/POST | `/category-groups` | user | `position` is server-assigned on create, scoped to the group kind. |
| PATCH/DELETE | `/category-groups/{id}` | user | Kind changes and deletes are blocked while categories, budgets, or allocations reference the group (409). |
| POST | `/category-groups/reorder` | user | Body `{kind, ordered_ids}`. 204. Ids outside the kind are silently ignored, matching the frontend mock store. |
| POST | `/categories/reorder` | user | Body `{kind, group_id, ordered_ids}`. 204. Ids outside the `(kind, group_id)` sibling group are silently ignored, matching the frontend mock store. |
| GET | `/budgets` | user | |
| PUT | `/budgets` | user | Upsert, keyed on `(group_id, month)`. |
| DELETE | `/budgets/{id}` | user | |
| GET | `/budget-allocations` | user | |
| PUT | `/budget-allocations` | user | Upsert, keyed on `group_id`. |
| DELETE | `/budget-allocations/{id}` | user | |
| GET | `/expected-income` | user | |
| PUT | `/expected-income` | user | Upsert, keyed on `month`. No delete. |
| GET | `/transactions?account_id=&category_id=&group_id=&institution_id=&type=&date_from=&date_to=&search=&amount_min=&amount_max=&sort=&order=&limit=&offset=` | user | All optional. `account_id`/`institution_id` match either leg of a transfer; `group_id` matches any category in that group; `amount_min`/`amount_max` compare the raw `NUMERIC` regardless of currency. `sort` ∈ `date`/`description`/`amount` (default `date`), `order` ∈ `asc`/`desc` (default `desc`). When `limit` is given the response carries an `X-Total-Count` header with the unpaginated match count. |
| POST | `/transactions` | user | See "Transactions" below. |
| POST | `/transactions/bulk-delete` | user | Body `{ids: [...]}` (1–500). Atomic: one foreign/unknown id → 404, nothing deleted. 204. |
| POST | `/transactions/bulk-categorize` | user | Body `{ids: [...], category_id}`. Atomic: rejects a transfer/interest row or a category-kind mismatch (422), else assigns and returns `{updated}`. |
| GET/PATCH | `/transactions/{id}` | user | |
| DELETE | `/transactions/{id}` | user | |
| GET/POST | `/recurring-rules` | user | See "Recurring rules" below. |
| PATCH | `/recurring-rules/{id}` | user | `template`, if present, replaces the whole template (not deep-merged). |
| DELETE | `/recurring-rules/{id}` | user | |
| GET | `/manual-rates` | user | |
| PUT | `/manual-rates/{pair}/{date}` | user | `{pair}` like `USD_BRL`; `{date}` is `YYYY-MM-DD`. Body `{rate}`. |
| DELETE | `/manual-rates/{id}` | user | |
| GET/POST | `/goals` | user | No delete - archive only. |
| POST | `/goals/with-account` | user | Creates a goal and its goal-type account in one response. |
| PATCH | `/goals/{id}` | user | |
| PATCH | `/goals/{id}/with-account` | user | Updates a goal and its linked account in one response. |
| POST | `/goals/{id}/archive` | user | |
| GET | `/agents/providers` | admin | Every route under `/agents` 404s `agents.disabled` unless `AGENTS_ENABLED=true`; members receive `auth.admin_required`. See "AI agents" below. |
| PUT | `/agents/providers/{provider}` | admin | Body `{api_key?, base_url?, model?, reasoning_effort?}`. Links an api-key or Ollama credential; also used model/effort-only, without an `api_key`/`base_url`, to change an already-linked provider's model or reasoning effort. |
| DELETE | `/agents/providers/{provider}` | admin | 204. Unlinks; the `.env` credential (if any) resumes. |
| POST | `/agents/providers/{provider}/oauth/start` | admin | → `{authorize_url, verifier, state}`. |
| POST | `/agents/providers/{provider}/oauth/complete` | admin | Body `{verifier, state, code}`. |
| POST | `/agents/providers/{provider}/test` | admin | → `{ok, error_code?}`. |
| GET | `/agents/conversations` | user | Lists conversations, newest first. |
| POST | `/agents/conversations` | user | Creates a conversation, optionally pinned to a configured provider. |
| GET | `/agents/conversations/{id}` | user | Returns a conversation and its ordered messages. |
| DELETE | `/agents/conversations/{id}` | user | Deletes the conversation and its messages. |
| POST | `/agents/conversations/{id}/messages` | user | Body `{content}`. Streams the assistant response as `text/event-stream`. Members need `ai_chat_enabled`. |
| POST | `/agents/conversations/{id}/confirm` | user | Body `{tool_call_id, approved, arguments?}`. Confirms or rejects a pending write tool and streams the follow-up as `text/event-stream`. |
| POST | `/agents/mcp-token` | user | → `{token, expires_at}`, shown once. Long-lived bearer for the standalone MCP server. Members need `ai_chat_enabled`. |
| GET | `/agents/instructions` | user | → `{instructions}`, the caller's stored custom instructions, or `null`. |
| PUT | `/agents/instructions` | user | Body `{instructions}` (max 2000 chars). Classified before it is stored; off-topic text is refused with `agents.instructions_rejected` and never saved. An empty value clears the field without contacting a provider. |
| GET/POST | `/investments/wallets` | user | Investment wallets, each with a linked investment account. |
| GET/PATCH | `/investments/wallets/{id}` | user | |
| POST | `/investments/wallets/{id}/archive` | user | Body `{archived}`. |
| GET/POST | `/investments/assets` | user | User-owned asset registry. |
| GET/PATCH | `/investments/assets/{id}` | user | |
| POST | `/investments/assets/{id}/archive` | user | Body `{archived}`. |
| GET/POST | `/investments/transactions` | user | Investment ledger entries; buy/sell cash legs are optional. |
| GET/PATCH/DELETE | `/investments/transactions/{id}` | user | |
| GET | `/investments/wallets/{id}/positions` | user | Average-cost positions with manual, cached, or live prices. |
| GET | `/investments/summary` | user | Summary across wallets in the first wallet's currency. |
| GET | `/market-data/credentials` | user | Provider status only; never returns API keys. |
| PUT/DELETE | `/market-data/credentials/{provider}` | user | Link or remove a Twelve Data or brapi API key. |

## Investments

Wallets own an investment account and may point at a separate cash account for
buy/sell settlement. Assets are user-owned symbols with a currency and either
a manual price or a live quote provider. Transactions are the source of truth:
positions fold buys, sells, dividends, and fees using average cost, so `amount`
for a buy or sell is always derived from `quantity * price` on the server rather
than trusted from the request. Transaction currency must match the wallet's
currency because the position fold does no currency conversion. Updating or
deleting a transaction re-folds the affected ledgers before commit and rejects
changes that would make a later sell impossible; user-owned ids return the
resource-specific 404 whether missing or owned by someone else.

For wallets with a linked cash account, the optional cash leg is settled as
follows:

| Investment event | Transfer direction | Transfer amount |
| --- | --- | --- |
| Buy | Cash account → investment account | `quantity * price + fee` |
| Sell | Investment account → cash account | `quantity * price - fee` |

Positions resolve each price independently in this order: manual price (or an
asset configured for manual quotes), today's cached quote, one batched live
provider request per provider in use, the newest cached quote marked stale,
then no price. A provider outage or missing credential therefore leaves the
position readable; market value and unrealized gain are null when no price is
available. Cross-currency market values use the normal exchange-rate service
and retain its fallback warning flag.

| Code | Status |
| --- | --- |
| `investment_wallet.not_found` | 404 |
| `investment_wallet.currency_in_use` | 422 |
| `investment_asset.not_found` | 404 |
| `investment_asset.symbol_already_exists` | 409 |
| `investment_transaction.not_found` | 404 |
| `investment_transaction.quantity_price_required` | 422 |
| `investment_transaction.quantity_price_not_allowed` | 422 |
| `investment_transaction.asset_required` | 422 |
| `investment_transaction.currency_must_match_wallet` | 422 |
| `investment_transaction.insufficient_quantity` | 422 |
| `investment_transaction.settlement_amount_not_positive` | 422 |
| `investment_transaction.ledger_invalid` | 422 |

## Market data

Market-data credentials are user-owned, encrypted API-key rows in their own
table, separate from administrator AI-provider credentials. Status responses
only say whether a provider is configured and where it came from. Resolution
uses a user's decrypted row first, then the instance `.env` fallback
(`TWELVE_DATA_API_KEY` for Twelve Data or `BRAPI_TOKEN` for brapi), then no
credential. Linking and unlinking are available to every authenticated user;
unknown providers are rejected.

| Code | Status |
| --- | --- |
| `market_data_credential.not_found` | 404 |
| `market_data_credential.provider_unknown` | 422 |

## Transactions

`POST`/`PATCH /transactions` enforce, in order:

1. `amount > 0` (Pydantic `Field(gt=0)` → `error.validation` if violated).
2. Every referenced `account_id`/`to_account_id`/`category_id`/
   `recurring_rule_id` belongs to the caller (404 otherwise).
3. Shape by `type` (`app/services/transactions.py::validate_transaction_shape`,
   shared verbatim with recurring-rule template validation):

   | `type` | Requires | Forbids |
   | --- | --- | --- |
   | `transfer` | `to_account_id` (distinct from `account_id`) | `category_id` |
   | `income` / `expense` | `category_id` (kind must match: `income`→`income`, `expense`→`expense`) | `to_account_id` |
   | `interest` | - | `category_id`, `to_account_id` |

4. Cross-currency conversion, if the transaction's currency differs from
   the destination account's currency - see `money-and-currency.md` for the
   full validation. Same-currency transactions must **not** include a
   `conversion` object.

Negative derived balances are allowed on purpose - credit cards are debt by
design, and there is no balance-floor check anywhere in this API. Balances
themselves are never stored; they're always `opening_balance` + every
transaction touching the account, computed on the client
(`domain/calc/balances.ts`) - there is no `GET .../balance` endpoint.

### Transaction error codes

| Code | Status |
| --- | --- |
| `transaction.not_found` | 404 |
| `transaction.transfer_requires_destination` | 422 |
| `transaction.transfer_same_account` | 422 |
| `transaction.transfer_has_category` | 422 |
| `transaction.destination_not_allowed` | 422 |
| `transaction.interest_has_category` | 422 |
| `transaction.category_required` | 422 |
| `transaction.category_kind_mismatch` | 422 |
| `transaction.conversion_required` | 422 |
| `transaction.conversion_not_needed` | 422 |
| `transaction.conversion_currency_mismatch` | 422 |
| `transaction.conversion_mismatch` | 422 |
| `transaction.conversion_fee_exceeds_amount` | 422 |

### Transaction import

`POST /transactions/import/preview` and `POST /transactions/import`
(`app/services/csv_import.py`) turn a bank-statement CSV into candidate
transactions for review, then commit the ones the caller confirms. There is
no multipart upload - the frontend reads the file client-side (`File.text()`)
and posts its text as a JSON string field, so both endpoints are ordinary
JSON requests.

**Preview** (`ImportPreviewRequest` → `ImportPreviewRead`) never writes
anything. It takes the raw CSV `content`, a target `account_id`, an optional
`mapping` (target field → CSV header; omitted or `{}` asks the server to
guess from the headers), and `options` (`date_format`: `auto`/`iso`/`dmy`/
`mdy`; `decimal_separator`: `auto`/`.`/`,`; `invert_sign`). It returns every
detected `headers`, the `mapping` actually used (the guess, or the caller's
mapping echoed back), and one `rows` entry per CSV data row:

- `type`/`amount` are derived from the amount column's sign (negative →
  `expense`, positive → `income`, `invert_sign` flips this) - import only
  ever produces income/expense rows, never transfers or interest.
- `category_id` is set only when a `category` column is mapped and its text
case-insensitively matches one of the caller's own categories
  whose `kind` matches the row's derived type; otherwise `null` and the
  frontend must ask the user to pick one before the row can be reviewed.
- `error` is one of the codes below when a row can't be parsed - such a row
  is returned (not dropped) so the frontend can show it, but the frontend
  gates its own "reviewed" checkbox on `error` being absent.
- `duplicate` is `true` when an existing transaction on the same account
  already matches `(date, amount, description)` case-insensitively - a
  single query against the CSV's date range, not one query per row.

Limits, rejected as `error.validation` (`ValidationAppError`, not per-row):
content over 2 MiB, over 2000 data rows, zero data rows, or the `date`/
`description`/`amount` target fields left unmapped after guessing.

**Commit** (`ImportCommitRequest{items}` → `{created}`) reuses
`TransactionCreate` verbatim for `items` - the frontend sends exactly the
rows it marked reviewed, with any edits already applied, through the same
per-row shape as a normal `POST /transactions`
(`app/services/transactions.py::build_transaction`). All-or-nothing: every
item is validated and staged in one session, then committed together: if
any item fails, the whole batch is rolled back rather than left partially
posted (the caller already saw a preview, so a failure here is exceptional).

| Code | Status |
| --- | --- |
| `import.file_too_large` | 422 |
| `import.no_rows` | 422 |
| `import.too_many_rows` | 422 |
| `import.column_required` | 422 |
| `import.row.invalid_date` | (row-level, not raised) |
| `import.row.invalid_amount` | (row-level, not raised) |
| `import.row.zero_amount` | (row-level, not raised) |
| `import.row.missing_description` | (row-level, not raised) |

## Recurring rules

`template` mirrors a transaction (minus `id`/`date`/`recurring_rule_id`) and
is validated with the identical shape/conversion rules above - a bad
template surfaces the matching `transaction.*` code, not a separate
`recurring_rule.*` one. Rules are stored as real foreign-key columns
(`template_account_id`, `template_category_id`, ...), not JSONB, so a
referenced account or category must exist and belong to the caller just
like a real transaction's would.

This router is CRUD only. A Celery beat task (`app/workers/tasks/recurring.py`,
running daily at 01:00 UTC) posts each rule's due occurrences as real
Transactions via `app/services/recurring_posting.py` - there is no HTTP
endpoint to trigger it. `RecurringRuleRead.last_posted_date` is that task's
cursor: the last occurrence date actually posted, `null` if none yet.
Posting is idempotent twice over - the cursor skips what it already posted,
and a partial unique index on `transactions (recurring_rule_id, date)`
makes a duplicate impossible at the database level even if a run is
retried. Cross-currency occurrences re-resolve a live exchange rate as of
each occurrence's own date rather than replaying the template's
`conversion` (frozen from whenever the rule was last edited) - so a rule
with a manual rate set after creation, or one that's simply been running
a while, posts at the rate that was actually in effect that day.

The frontend still projects *upcoming* occurrences on demand for display
(`domain/calc/recurrence.ts`) - those projections are separate from what
gets posted and are suppressed client-side once the matching transaction
exists, so a due occurrence never renders as both a ghost row and a real
one.

| Code | Status |
| --- | --- |
| `recurring_rule.not_found` | 404 |
| `recurring_rule.end_before_start` | 422 |

## Category groups and categories

Category groups organize categories and are the references used by budgets and
budget allocations. A group `kind` is `income` or `expense`; its position is
0-based and scoped to `(user, kind)`. A group cannot change kind or be deleted
while it is referenced by any category, budget, or allocation.

Every category requires a `group_id`, and its `kind` must match the group's
kind. Category positions are 0-based, scoped to `(kind, group_id)`, and
server-assigned on create (`max(sibling positions) + 1`, or `0`). Categories
are not nested or archived. A category can move between groups of the same
kind; changing its kind requires changing it to a matching group in the same
request.

Changing a category's kind is blocked while a transaction or recurring
template references it (`category.kind_immutable`). The same two-reference
check protects deletion (`category.in_use`); budgets and allocations reference
the group instead.

| Code | Status | Meaning |
| --- | --- | --- |
| `category_group.not_found` | 404 | Group is unknown or belongs to another user. |
| `category_group.in_use` | 409 | Group has categories, budgets, or allocations. |
| `category_group.kind_immutable` | 409 | Group kind cannot change while it is in use. |
| `category.not_found` | 404 | Category is unknown or belongs to another user. |
| `category.group_kind_mismatch` | 422 | Category kind does not match its group kind. |
| `category.kind_immutable` | 409 | A transaction or recurring template references the category. |
| `category.in_use` | 409 | A transaction or recurring template references the category. |

## Institutions and accounts

Credit-card-only fields (`credit_limit`, `closing_day`, `due_day`) are
rejected on every other account type, both by a CHECK constraint and a
service-level 422. Institution delete is blocked while any account still
references it (DB `RESTRICT` FK is the backstop; the service checks first
for the friendly error).

| Code | Status |
| --- | --- |
| `institution.not_found` | 404 |
| `institution.has_accounts` | 409 |
| `account.not_found` | 404 |
| `account.credit_fields_not_applicable` | 422 |

## Goals

Metadata over a goal-type account: `account_id` must reference an account
the caller owns with `type: "goal"`, and `currency` must match that
account's own currency (the frontend's balance/remaining math subtracts
them directly and throws on a mismatch - see `domain/calc/goals.ts`). One
goal per account (`uq_goals_account_id`). `interval` requires `frequency`.
No delete - archive only, matching `GoalRepository`.

| Code | Status |
| --- | --- |
| `goal.not_found` | 404 |
| `goal.account_not_goal_type` | 422 |
| `goal.currency_mismatch` | 422 |
| `goal.account_already_has_goal` | 409 |
| `goal.interval_requires_frequency` | 422 |

## Exchange rates and manual rates

`GET /meta/exchange-rate` follows the full precedence in
`money-and-currency.md` (identity → the caller's manual rate → its inverse
→ cached provider rate → 1:1 fallback). It is a pure read and never fetches
from the provider; the cache is filled by the scheduled Celery task, by
currency-introducing writes, at API startup, and by the refresh endpoint
below.

`POST /meta/exchange-rates/refresh` (admin only) pulls today's USD-anchored
rates from the provider ahead of the scheduled run. It is cooldown-gated by
`EXCHANGE_RATE_REFRESH_COOLDOWN_MINUTES` (default 15), shared across
processes; inside the cooldown it returns `{as_of, updated: 0, throttled:
true, refreshed_at}` without a provider call. Read-computed values pick up
new rates immediately; transactions frozen at the 1:1 fallback still heal
via the nightly backfill task.

`PUT /manual-rates/{pair}/{date}` upserts, keyed on `(user, base_code,
quote_code, as_of)`; `{pair}` is two 3-letter codes joined by `_`
(`USD_BRL`), case-insensitive.

| Code | Status |
| --- | --- |
| `manual_rate.not_found` | 404 |
| `manual_rate.same_currency` | 422 |
| `manual_rate.invalid_pair` | 422 |

## Updates

`GET /meta/update-status` compares the running instance's version against the
latest published release on GitHub. The response is `{current_version,
latest_version, update_available, release_url}`; `latest_version` and
`release_url` are `null` when there is no newer release, the check is
disabled (`UPDATE_CHECK_ENABLED=false`), or the GitHub API call failed. The
endpoint never surfaces a provider outage to the caller.

## Budgets and budget planning

`budgets`, `budget_allocations`, and `expected_income` are all upsert-first
(`PUT`), keyed on `(group_id, month)`, `group_id`, and `month`
respectively (each scoped to the caller). `month` is validated as
`YYYY-MM` at both the Pydantic layer (regex) and the database (CHECK) -
never a `Date` pinned to the 1st.

| Code | Status |
| --- | --- |
| `budget.not_found` | 404 |
| `budget_allocation.not_found` | 404 |
| `budget_allocation.group_must_be_expense` | 422 |
| `expected_income.not_found` | 404 |

## Currency

| Code | Status |
| --- | --- |
| `currency.not_found` | 404 |
| `currency.inactive` | 422 |

## AI agents

See [`ai-agents.md`](ai-agents.md) for provider setup, credential
precedence, the OAuth linking flow, the tool set, and the MCP server.
`provider` is one of `anthropic`, `openai`, `ollama`.

Provider linking is administrator-only. Active administrators always have chat
access; members are gated by the admin-set `ai_chat_enabled` flag on the user
(see `PATCH /auth/users/{id}`).

### Custom instructions

A user can store free text that is folded into the system prompt, so it is
admitted only after the user's own provider classifies it: text that is not
about that user's finances or the use of this application is refused with
`agents.instructions_rejected`, whose `params.reason` carries one short
sentence written in the user's locale. Saving therefore needs a working
provider - `agents.not_configured` (422) or `agents.provider_unavailable`
(502) when none is reachable. Clearing the field is the exception and always
works. The value is per user, is not a preference on `/auth/preferences`, and
is excluded from backup export/restore.

### Streaming responses

`/messages` and `/confirm` respond with `text/event-stream`. The client must
POST (not `EventSource`) so the `X-XSRF-TOKEN` header can be sent. Frames are
`event: <name>\ndata: <json>\n\n`, interleaved with `: heartbeat\n\n` comments.
Every stream ends with exactly one `done` **or** one `error`.

| Event | Payload |
| --- | --- |
| `delta` | `{text}` - append to the current assistant message |
| `tool_call` | `{id, name, arguments}` - a read tool started |
| `tool_result` | `{id, name, ok}` - that tool finished |
| `tool_confirm` | `{id, name, arguments}` - a write tool is waiting; call `/confirm` |
| `refusal` | `{code}` - always `agents.off_topic`; render a translated message |
| `error` | `{code, params}` - same envelope as a normal error body |
| `done` | `{status, message_id}` - `status` is `idle` or `awaiting_confirmation` |

Failures before the `200` (unknown conversation, flag off, stale confirm) are
normal JSON error bodies with real status codes; failures after it are `error`
frames carrying the same `code`/`params`.

| Code | Status |
| --- | --- |
| `agents.disabled` | 404 |
| `agents.chat_not_allowed` | 403 |
| `agents.provider_unknown` | 404 |
| `agent_credential.not_found` | 404 |
| `agent_conversation.not_found` | 404 |
| `agents.not_configured` | 422 |
| `agents.api_key_required` | 422 |
| `agents.base_url_required` | 422 |
| `agents.tool_arguments_invalid` | 422 |
| `agents.instructions_rejected` | 422 |
| `analytics.invalid_month` | 422 |
| `agents.oauth_unsupported` | 422 |
| `agents.oauth_state_mismatch` | 422 |
| `agents.oauth_failed` | 422 |
| `agents.provider_unavailable` | 502 |
| `agents.no_pending_tool` | 409 |
| `agents.awaiting_confirmation` | 409 |
| `agents.tool_loop_exhausted` | 200 (error event) |
| `agents.off_topic` | 200 (refusal event) |
