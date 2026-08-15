# Backend API

Endpoints, ownership rules, error codes, and the bootstrap procedure for the
FastAPI backend. See [`architecture.md`](architecture.md) for service
topology and [`money-and-currency.md`](money-and-currency.md) for the
monetary/conversion rules referenced below.

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

### Auth error codes

| Code | Status | When |
| --- | --- | --- |
| `auth.unauthenticated` | 401 | No session cookie, or the resolved user is missing. |
| `auth.session_invalid` | 401 | Cookie present but expired, revoked, or unknown. |
| `auth.invalid_credentials` | 401 | Wrong email/password at login (indistinguishable timing from an unknown email). |
| `auth.account_inactive` | 401 | Valid credentials/session, but the account is deactivated. |
| `auth.csrf_invalid` | 403 | State-changing request with a missing/mismatched `X-XSRF-TOKEN`. |
| `auth.forbidden` | 403 | Generic authorization failure. |
| `auth.admin_required` | 403 | Non-admin called an admin-only route. |
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
| POST | `/auth/invitations` | admin | Body `{email, role}`. Returns the raw token once. |
| GET | `/auth/invitations` | admin | Never includes the token. |
| DELETE | `/auth/invitations/{id}` | admin | Revoke. |
| POST | `/auth/register` | public | Body `{email, token, password, display_name}`. Logs in on success. |
| POST | `/auth/login` | public | Body `{email, password}`. |
| POST | `/auth/logout` | user | 204. |
| GET | `/auth/me` | user | |
| GET | `/auth/users` | admin | |
| PATCH | `/auth/users/{id}` | admin | `{role?, is_active?, display_name?}`. |
| GET/PATCH | `/auth/preferences` | user | `{locale, theme, display_currency, balances_hidden}` - stored as columns on `users`, not localStorage. |
| GET/POST | `/institutions` | user | |
| GET/PATCH | `/institutions/{id}` | user | |
| POST | `/institutions/{id}/archive` | user | Body `{archived}`. |
| DELETE | `/institutions/{id}` | user | Blocked while any account references it (409). |
| GET/POST | `/accounts` | user | No delete - archive only. |
| GET/PATCH | `/accounts/{id}` | user | |
| POST | `/accounts/{id}/archive` | user | Body `{archived}`. |
| GET/POST | `/categories` | user | `position` is server-assigned on create. |
| PATCH | `/categories/{id}` | user | |
| POST | `/categories/{id}/archive` | user | |
| DELETE | `/categories/{id}` | user | Blocked while referenced by children, budgets, budget allocations, transactions, or recurring templates (409). |
| POST | `/categories/reorder` | user | Body `{kind, parent_id, ordered_ids}`. 204. Ids outside the `(kind, parent_id)` sibling group are silently ignored, matching the frontend mock store. |
| GET | `/budgets` | user | |
| PUT | `/budgets` | user | Upsert, keyed on `(category_id, month)`. |
| DELETE | `/budgets/{id}` | user | |
| GET | `/budget-allocations` | user | |
| PUT | `/budget-allocations` | user | Upsert, keyed on `category_id`. |
| DELETE | `/budget-allocations/{id}` | user | |
| GET | `/expected-income` | user | |
| PUT | `/expected-income` | user | Upsert, keyed on `month`. No delete. |
| GET | `/transactions?account_id=&category_id=&type=&date_from=&date_to=` | user | All filters optional; `account_id` matches either leg of a transfer. |
| POST | `/transactions` | user | See "Transactions" below. |
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

## Recurring rules

`template` mirrors a transaction (minus `id`/`date`/`recurring_rule_id`) and
is validated with the identical shape/conversion rules above - a bad
template surfaces the matching `transaction.*` code, not a separate
`recurring_rule.*` one. Rules are stored as real foreign-key columns
(`template_account_id`, `template_category_id`, ...), not JSONB, so a
referenced account or category must exist and belong to the caller just
like a real transaction's would.

Rules are projections only: there is no posting workflow, and nothing here
computes or stores occurrences - that stays entirely client-side
(`domain/calc/recurrence.ts`) and never touches balances, budgets, or
reports.

| Code | Status |
| --- | --- |
| `recurring_rule.not_found` | 404 |
| `recurring_rule.end_before_start` | 422 |

## Categories

One level of nesting: a category with a `parent_id` must point at a
top-level category (itself with no parent), and a category that already has
children can't be given a parent either. `position` is 0-based, scoped to
the `(kind, parent_id)` sibling group, and server-assigned on create
(`max(sibling positions) + 1`, or `0`).

Changing `kind` on a category that has children or is referenced by a
budget, budget allocation, transaction, or recurring template is blocked
(`category.kind_immutable`). The same complete reference check protects
deletion (`category.in_use`). An allocated category also cannot be moved
under another category because allocations are defined only at the top level.

| Code | Status |
| --- | --- |
| `category.not_found` | 404 |
| `category.parent_not_top_level` | 422 |
| `category.parent_kind_mismatch` | 422 |
| `category.kind_immutable` | 409 |
| `category.in_use` | 409 |

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
→ cached provider rate → live provider fetch → 1:1 fallback). `PUT
/manual-rates/{pair}/{date}` upserts, keyed on `(user, base_code,
quote_code, as_of)`; `{pair}` is two 3-letter codes joined by `_`
(`USD_BRL`), case-insensitive.

| Code | Status |
| --- | --- |
| `manual_rate.not_found` | 404 |
| `manual_rate.same_currency` | 422 |
| `manual_rate.invalid_pair` | 422 |

## Budgets and budget planning

`budgets`, `budget_allocations`, and `expected_income` are all upsert-first
(`PUT`), keyed on `(category_id, month)`, `category_id`, and `month`
respectively (each scoped to the caller). `month` is validated as
`YYYY-MM` at both the Pydantic layer (regex) and the database (CHECK) -
never a `Date` pinned to the 1st.

| Code | Status |
| --- | --- |
| `budget.not_found` | 404 |
| `budget_allocation.not_found` | 404 |
| `expected_income.not_found` | 404 |

## Currency

| Code | Status |
| --- | --- |
| `currency.not_found` | 404 |
| `currency.inactive` | 422 |
