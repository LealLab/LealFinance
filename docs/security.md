# Security

How LealFinance protects a self-hosted install, what each layer does, and what
it does not do. To report a vulnerability, see [`SECURITY.md`](../SECURITY.md).

## Layers

| Layer | What it does | Where |
| --- | --- | --- |
| Per-IP rate limits | Slows password guessing and request floods | `docker/nginx/default.conf` |
| Security headers | Blocks framing, MIME sniffing, and loading data from other sites | `docker/nginx/security-headers.conf`, `docker/caddy/Caddyfile` |
| Account lockout | 5 bad passwords or codes lock one account for 15 minutes | `backend/app/services/auth.py` |
| Safe AI chat rendering | AI replies cannot load images or raw HTML from other sites | `frontend/src/app/shared/pipes/markdown.pipe.ts` |
| Dependency scanning | `pip-audit`, `pnpm audit` and Trivy run on every PR | `.github/workflows/ci.yml` |

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

## Logs

The logs never include provider API keys: the `httpx` and `httpcore` loggers
are held at WARNING, because they would otherwise print full request URLs and
some providers take their key in the URL.
