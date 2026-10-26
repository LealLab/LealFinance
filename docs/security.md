# Security

How LealFinance protects a self-hosted install, what each layer does, and what
it does not do. To report a vulnerability, see [`SECURITY.md`](../SECURITY.md).

## Layers

| Layer | What it does | Where |
| --- | --- | --- |
| Per-IP rate limits | Slows password guessing and request floods | `docker/nginx/default.conf` |
| Security headers | Blocks framing, MIME sniffing, and loading data from other sites | `docker/nginx/security-headers.conf`, `docker/caddy/Caddyfile` |
| Account lockout | 5 bad passwords or codes lock one account for 15 minutes | `backend/app/services/auth.py` |
| Security log | One JSON line per sign-in failure, lockout, and credential or admin change | `backend/app/core/logging.py` |
| Safe AI chat rendering | AI replies cannot load images or raw HTML from other sites | `frontend/src/app/shared/pipes/markdown.pipe.ts` |
| Dependency scanning | `pip-audit`, `pnpm audit` and Trivy run on every PR | `.github/workflows/ci.yml` |
| Secret scanning | gitleaks scans the full git history on every PR and push | `.github/workflows/ci.yml` |
| Code scanning | CodeQL analyses Python and TypeScript on PRs, pushes to `main`, and weekly | `.github/workflows/codeql.yml` |
| Container hardening | App containers drop all capabilities, cannot gain privileges, and have a process limit | `docker-compose.yml` |

## Rate limits (nginx)

All limits are per client IP, set in `docker/nginx/default.conf`. Going over a
limit returns `429` with the error code `error.rate_limited`, which the app
shows as a translated "too many requests" message.

| Endpoints | Limit |
| --- | --- |
| `/api/v1/auth/login`, `/login/passkey`, `/recover`, `/register` | about 10 a minute, with a burst of 10 |
| everything else under `/api/` | 20 a second, with a burst of 100; at most 50 open connections |

Slow or stalled connections are closed after 10 s (headers) or 30 s (body).

### Which IP is "the client"

Behind the optional Caddy TLS proxy every request comes from the Docker
network, so nginx reads `X-Forwarded-For`, but only from addresses inside
`172.16.0.0/12` (Docker's default range). A device on your home LAN that
connects directly is not in that range, so it cannot fake the header to dodge
the limits.

If you put your own proxy (Traefik, another nginx) in front and it is **not**
inside `172.16.0.0/12`, nginx sees the proxy's address for every visitor, so
all visitors share one set of limits. They are generous enough for a
household, but if you hit them, rebuild the web image with your proxy's range
in `set_real_ip_from`.

## Security headers

Every response from the `web` container carries:

- `Content-Security-Policy`: scripts only from the app itself, no framing, no
  plugins, and no images or other content from other sites. Styles allow
  `'unsafe-inline'` because Angular injects component styles at runtime.
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: same-origin`, and a `Permissions-Policy` that turns off
  camera, microphone, geolocation and payment.

The Caddy overlay also sends `Strict-Transport-Security` (1 year) over HTTPS.
Browsers remember it, so keep the site on HTTPS once you enable TLS.

The production build must not contain inline scripts, or the CSP would block
them. `angular.json` therefore turns off critical-CSS inlining, which is what
used to add one. After changing build options, check that
`dist/frontend/browser/index.html` has no inline `<script>`.

## Sign-in protection

- **Five wrong passwords lock the account for 15 minutes.** Five wrong
  authenticator or backup codes lock the second factor for 15 minutes.
- **Guesses are counted before they are checked**, in one atomic database
  step. A burst of simultaneous guesses therefore cannot get more than five
  checks, and a one-time code (authenticator or backup) can only be used once
  even if it is sent twice at the same moment.
- **A locked sign-in looks like a wrong password.** The public sign-in answers
  `invalid credentials` while an account is locked, so "locked" cannot be used
  to find out which email addresses have accounts. The side effect is that a
  locked-out user sees a normal "wrong password" message for up to 15 minutes.
  (When you are already signed in, changing your password or email still says
  the account is locked.)
- **Deactivating a user signs them out everywhere**, and the old sessions do
  not come back if the user is reactivated later.
- Lockout is per account, so someone who knows an email address can keep that
  account locked by guessing wrong on purpose. The per-IP limits above make
  that expensive but not impossible. Passkeys and trusted devices are not
  affected by a password lockout.

## Security log

Sign-in and account events go to a separate logger, `lealfinance.security`, as
one JSON line each on the API's output (`docker compose logs api`). Every line
has `event`, `client_ip` (the real visitor address, see
[Which IP is "the client"](#which-ip-is-the-client)), and a `user_id` when the
account is known. A line never contains a password, a code, a token, or an
email address, because people sometimes type a password into the email box.

```json
{"timestamp": "2026-10-26T11:08:09+00:00", "level": "WARNING", "logger": "lealfinance.security", "message": "password_failed", "event": "password_failed", "client_ip": "203.0.113.7", "user_id": "5b0f...", "attempt": 3}
```

| Event | Level | Meaning |
| --- | --- | --- |
| `login_failed` | WARNING | Unknown account (`reason: unknown_account`) or deactivated account |
| `password_failed` | WARNING | Wrong password, with the `attempt` number. Also logged when a signed-in user mistypes their password |
| `password_attempt_while_locked` | WARNING | A guess arrived while the account was locked |
| `account_locked` | WARNING | A lockout just started (`factor`: `password` or `second_factor`) |
| `second_factor_failed`, `second_factor_attempt_while_locked` | WARNING | Same, for authenticator and backup codes |
| `recover_failed`, `passkey_login_failed` | WARNING | Failed password recovery or passkey sign-in |
| `login_success` | INFO | Successful sign-in (`method`: `password` or `passkey`) |
| `password_changed`, `password_recovered` | INFO | Password reset |
| `totp_enabled`, `backup_codes_regenerated`, `passkey_added`, `mcp_token_issued` | INFO | Credential created |
| `totp_disabled`, `passkey_removed` | WARNING | A protection was removed |
| `user_updated` | INFO | An admin changed a role, active flag, or AI-chat access (`actor_id`, `target_id`) |

Useful queries: `docker compose logs api | grep '"event": "account_locked"'` for
lockouts, and the same with `password_failed` to see who is guessing.

### Banning repeat offenders with fail2ban (example, not tested here)

fail2ban can read these lines and block an address at the host firewall. This
filter matches the failure events for Docker's default `json-file` log driver
(it escapes the quotes). Adjust the log path to your container, and use a
fail2ban action that works with Docker's published ports (the `DOCKER-USER`
chain), since a plain `INPUT` rule does not apply to them.

```ini
# /etc/fail2ban/filter.d/lealfinance.conf
[Definition]
failregex = \\"event\\": \\"(?:login_failed|password_failed|password_attempt_while_locked|second_factor_failed|recover_failed|passkey_login_failed)\\", \\"client_ip\\": \\"<HOST>\\"
```

A successful ban only helps if the address in the log is the real visitor, so
check a sample line first. An alert (email, chat message) on `account_locked`
is a lighter alternative that needs no firewall changes.

## AI chat output

AI replies can repeat text an attacker planted in your data, such as an
imported transaction description. The chat therefore shows markdown images as
their alt text, shows raw HTML as plain text, and opens links in a new tab with
`rel="noopener noreferrer"`. The CSP is a second line of defence: even if an
image tag got through, the browser would refuse to load it.

## Network exposure

- `docker compose up` (development) publishes Postgres and Redis only on
  `127.0.0.1`. Redis has no password, so never publish it to other hosts.
- The base and production compose files publish no database ports at all.
- Set `ENVIRONMENT=production` for any real deployment. `task install` does
  this for you; it makes cookies `Secure` and rejects placeholder secrets.
- A volumetric DDoS fills your internet connection before it reaches the app,
  so no application setting can stop it. If that is a concern, put the site
  behind a network-level service (for example Cloudflare), or keep it
  private on a VPN such as Tailscale.

## CI scanning

- Workflows get a read-only `GITHUB_TOKEN` by default (`permissions: contents:
  read`). A job that needs more, such as CodeQL uploading results, asks for it
  itself. Every action is pinned to a commit SHA, and Dependabot keeps the pins
  current.
- **gitleaks** runs as the CLI (a pinned release, checked against its published
  SHA-256), not as `gitleaks-action`, which needs a paid licence for
  organisation repositories. It scans every commit in the history. A finding
  fails the job: rotate the secret first, and only then decide whether to add an
  allowlist entry in a `.gitleaks.toml`. Run it locally with
  `docker run --rm -v "$PWD:/repo" ghcr.io/gitleaks/gitleaks:v8.30.1 git /repo`.
- **CodeQL** results appear under the repository's Security tab.
- Dependabot watches the GitHub Actions, pip and npm dependencies, the base
  images in `backend/Dockerfile` and `frontend/Dockerfile`, and the images
  named in the compose files (Postgres, Redis, Ollama, Caddy).

## Container hardening

`api`, `worker`, `beat`, `mcp` and `web` run as a non-root user and set:

- `cap_drop: [ALL]`: no Linux capabilities. They do not need any.
- `security_opt: ["no-new-privileges:true"]`: a process cannot gain privileges
  through setuid binaries.
- `pids_limit: 512`: a runaway or abused process cannot fork without limit.

Postgres, Redis, Ollama and Caddy are left as they are: their images start as
root or bind privileged ports, so dropping capabilities would need testing per
image.

There are **no memory limits** on purpose. A limit set without measuring can
get a busy container killed. To add one, watch `docker stats` under normal use
and then set it with a margin on the service in your own compose override, for
example `mem_limit: 1g` on `api`.

If you build your own image or override that runs an application container as
root or with an extra capability, these settings can stop it from starting.

## Known gaps

- **Redis has no password.** It is reachable only from the compose network (and
  from `127.0.0.1` in development), but any container on that network can read
  and write it. Adding one needs an upgrade path for existing installs, so it
  is not done yet. Never publish the Redis port to other hosts.

## Logs

The logs never include provider API keys: the `httpx` and `httpcore` loggers
are held at WARNING, because they would otherwise print full request URLs and
some providers take their key in the URL.
