# Optional configuration

LealFinance runs with only `POSTGRES_PASSWORD` and `API_SECRET_KEY` set. Every
feature on this page is off, or falls back to a safe default, until you add its
settings to `.env`. `task install:wizard` asks about each block and writes the
values for you; to do it by hand, edit `.env` (start from `.env.example`).

| Feature | Turned on by | Without it |
| --- | --- | --- |
| [HTTPS](#https-tls-proxy) | `LF_SITE_ADDRESS` + `APP_BASE_URL`, `task install:tls` | Plain HTTP; other devices cannot stay logged in |
| [Invitation email](#invitation-email-smtp) | `SMTP_HOST` + `APP_BASE_URL` | Admin copies the invitation link by hand |
| [AI assistant](#ai-assistant) | `AGENTS_ENABLED=true` | No chat, no AI import assist, no MCP |
| [Exchange rates](#exchange-rates) | `OPENEXCHANGERATES_APP_ID` | Cross-currency rates use a flagged 1:1 fallback |
| [Market quotes](#market-quotes-for-investments) | `TWELVE_DATA_API_KEY`, `BRAPI_TOKEN`, `COINGECKO_API_KEY` | Manual prices; crypto still prices via CoinGecko |
| [Update check](#update-check) | On by default; `UPDATE_CHECK_ENABLED=false` turns it off | - |
| [Session tuning](#session-and-invitation-lifetimes) | `SESSION_TTL_DAYS`, `INVITATION_TTL_DAYS`, `TRUSTED_DEVICE_TTL_DAYS` | 30 / 7 / 30 days |

**Applying changes.** Docker Compose reads `.env` when a container is created.
After editing it, recreate the affected containers:

```bash
docker compose up -d
```

`docker compose restart` does **not** re-read `.env`. On a published-image
install add `-f docker-compose.yml -f docker-compose.prod.yml` (and
`-f docker-compose.tls.yml` behind the TLS proxy), or just run `task install`
(`task install:tls`). When running the API natively, restart `task backend:dev`.

## HTTPS (TLS proxy)

The bundled `web` container serves plain HTTP. With `ENVIRONMENT=production`
the session and CSRF cookies are `Secure`, and browsers only send those back over
HTTPS (the one exception is `http://localhost` on the host itself). Reaching
the app from any other device therefore needs HTTPS.

| Variable | Purpose |
| --- | --- |
| `LF_SITE_ADDRESS` | Hostname the app is reached at, without scheme (`finance.example.com`). Read only by the Caddy proxy. |
| `APP_BASE_URL` | The same origin with scheme (`https://finance.example.com`). |
| `WEB_PORT` | Set to `127.0.0.1:8081` so plain HTTP stays on loopback and only Caddy is reachable from the network. |

Start the stack with `task install:tls`. Caddy obtains and renews a Let's Encrypt
certificate when the name is publicly resolvable with port 443 reachable. For
a LAN-only name, uncomment `tls internal` in `docker/caddy/Caddyfile` and trust
Caddy's local CA on each device. Passkey sign-in (Settings -> Passkeys) needs
a secure context and works as soon as the app is served over HTTPS.

Already running Traefik, nginx, or your own Caddy? Skip the overlay and follow
[Bring your own proxy](homelab-deploy.md#bring-your-own-proxy). Full walkthrough:
[`homelab-deploy.md`](homelab-deploy.md#https).

## Invitation email (SMTP)

Registration is invite-only after the first administrator. By default an
administrator copies the invitation link from the users screen and shares it
themselves. Configuring SMTP makes the app email the link instead.

```dotenv
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USERNAME=lealfinance@example.com
SMTP_PASSWORD=app-password
SMTP_STARTTLS=true
SMTP_FROM=lealfinance@example.com
APP_BASE_URL=https://finance.example.com
```

| Variable | Default | Notes |
| --- | --- | --- |
| `SMTP_HOST` | empty | Setting it (with `APP_BASE_URL`) turns email on. |
| `SMTP_PORT` | `587` | |
| `SMTP_USERNAME` / `SMTP_PASSWORD` | empty | Login is attempted only when both are set. Leave both empty for a relay that needs no auth. |
| `SMTP_STARTTLS` | `true` | Upgrades the connection with STARTTLS. Set `false` only for a trusted local relay. |
| `SMTP_FROM` | `SMTP_USERNAME` | Sender address. Falls back to the username, then `lealfinance@localhost`. |
| `APP_BASE_URL` | empty | **Required** with `SMTP_HOST`: it is the origin the emailed link points to. In production the API refuses to start if `SMTP_HOST` is set without it. |

- Email is only enabled when **both** `SMTP_HOST` and `APP_BASE_URL` are set.
- Only the `api` container sends mail. Connections use plain SMTP with optional
  STARTTLS; implicit-TLS (SMTPS, usually port 465) is not supported, so use
  port 587 (or 25 for a local relay).
- A delivery failure is logged and never blocks the invitation. The token is
  already saved, so the admin can still copy the link.
- The link is valid for `INVITATION_TTL_DAYS` (default 7).

## AI assistant

A streaming chat over the user's own data, an opt-in AI assist for categorizing
imported transactions, and an MCP server for external clients. Off by default:
while `AGENTS_ENABLED=false` every `/api/v1/agents/*` route answers
`agents.disabled` and no provider is ever called.

```dotenv
AGENTS_ENABLED=true
ANTHROPIC_API_KEY=            # optional instance-wide key
OPENAI_API_KEY=               # optional instance-wide key
OLLAMA_BASE_URL=http://ollama:11434
COMPOSE_PROFILES=agents
```

| Variable | Purpose |
| --- | --- |
| `AGENTS_ENABLED` | Master switch for chat, import assist, and the MCP server. |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | Instance-wide provider keys, used when no administrator has linked their own credential. A linked credential always wins. |
| `OLLAMA_BASE_URL` | Address of an Ollama server. `http://ollama:11434` targets the bundled container; use your own URL for an external server. |
| `COMPOSE_PROFILES=agents` | Also starts the bundled `ollama` container and the `mcp` server (port 8001, not published). |
| `AGENTS_DEFAULT_PROVIDER` | Accepted by the config and wizard, but nothing reads it yet, so it has no effect. |

You do not need any key in `.env`: an administrator can link providers from
Administration -> AI providers (API key, or a Claude/ChatGPT subscription login).
After enabling the feature:

1. An administrator links a provider, or you set a key above.
2. Active administrators can chat right away. For each member who should have
   chat, an administrator turns on **AI chat** under Administration -> Users.
3. The bundled Ollama runs models locally, but the container starts empty:
   pull a model into it first (for example
   `docker compose exec ollama ollama pull llama3.1`).

Things to know:

- Assistant writes are never applied without your confirmation, and every one is
  journaled so it can be undone.
- The MCP server accepts active administrators only, with a token minted from
  `POST /api/v1/agents/mcp-token`. Publishing port 8001 to reach it from
  another machine is your decision.
- Ollama is supported for plain chat; its tool-calling is best-effort.
- Provider secrets are encrypted with a key derived from `API_SECRET_KEY` and
  never returned by the API. Rotating that key invalidates stored credentials
  and MCP tokens.

Full details, tool list, and security notes: [`ai-agents.md`](ai-agents.md).

## Exchange rates

Multi-currency works without any key, but conversions between two different
currencies then use a **flagged 1:1 fallback**. Add a free
[Open Exchange Rates](https://openexchangerates.org/signup/free) key for real
rates:

```dotenv
OPENEXCHANGERATES_APP_ID=your-app-id
EXCHANGE_RATE_REFRESH_COOLDOWN_MINUTES=15
```

What the key switches on:

- a scheduled refresh of today's rates every six hours;
- a rate fetch whenever a write introduces a new currency (account, goal, or
  investment wallet) and once at API startup;
- a nightly backfill that re-converts transactions saved at the 1:1 fallback,
  using the rate for each transaction's own date;
- the administrator **Refresh now** button on the exchange-rates page.

| Variable | Default | Notes |
| --- | --- | --- |
| `OPENEXCHANGERATES_APP_ID` | empty | Read by `api`, `worker`, and `beat`; recreate all three after changing it. |
| `EXCHANGE_RATE_REFRESH_COOLDOWN_MINUTES` | `15` | Minimum gap between manual refreshes. The provider updates hourly, so a lower value mostly spends quota. |

The free plan is capped at about 1,000 requests a month; the cache is
USD-anchored so one request covers every currency. Manual rates you enter
yourself always take precedence over provider rates. See
[`money-and-currency.md`](money-and-currency.md).

## Market quotes for investments

Investment assets can always be priced by hand. These keys add live quotes:

| Variable | Provider | Covers |
| --- | --- | --- |
| `TWELVE_DATA_API_KEY` | [Twelve Data](https://twelvedata.com/) | Global equities and ETFs |
| `BRAPI_TOKEN` | [brapi](https://brapi.dev/) | Brazilian (B3) tickers such as `PETR4` |
| `COINGECKO_API_KEY` | [CoinGecko](https://www.coingecko.com/en/api) | Crypto. **No key is needed**: crypto prices work anonymously, and a key only raises the rate limit. |

These are instance-wide fallbacks. Any user can link their own key under
Settings, and a user's key takes precedence over the `.env` value. If a
provider fails, positions fall back to the cache, then to a stale quote, then to
no price. Nothing errors. See [`investments.md`](investments.md).

Only the `api` container reads these; recreate it after changing them.

## Update check

Administrators see an in-app banner when a newer release is published. It shows
`task update`, backup instructions, and the release notes. The check makes one
anonymous request to the project's public GitHub releases API, cached for six
hours, and sends no instance data. Source builds (`dev` version) never report an
update.

```dotenv
UPDATE_CHECK_ENABLED=false   # no outbound request; for air-gapped installs
```

`TAG` (`latest` or a pinned `v1.2.3`) selects which published image `task
install` and `task update` pull. See
[Choosing a TAG](homelab-deploy.md#choosing-a-tag).

## Session and invitation lifetimes

| Variable | Default | Controls |
| --- | --- | --- |
| `SESSION_TTL_DAYS` | `30` | How long a login stays valid. |
| `INVITATION_TTL_DAYS` | `7` | How long an invitation link works. |
| `TRUSTED_DEVICE_TTL_DAYS` | `30` | How long "trust this device" skips the two-factor prompt on that browser. |

## Related settings

These are not optional features but are often changed with them:

- `ENVIRONMENT`: use `production` for any real deployment. It makes cookies
  `Secure` and makes the API refuse the placeholder `POSTGRES_PASSWORD` and
  `API_SECRET_KEY`.
- `DEFAULT_CURRENCY` and `DEFAULT_LOCALE`: defaults for new users.
- `WEB_PORT`, `POSTGRES_HOST_PORT`, `REDIS_HOST_PORT`: host ports; change them
  if they clash with another service.
- `LOG_LEVEL`: `INFO` by default.
