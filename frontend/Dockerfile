# syntax=docker/dockerfile:1
#
# Built with the repo root as context (see docker-compose.yml's `web`
# service: context: .., dockerfile: frontend/Dockerfile) so this can COPY
# the shared nginx config from docker/nginx/ alongside the frontend source.

# --- Builder: install deps and produce a production build ---------------------
FROM node:24-alpine AS builder

WORKDIR /app
ENV CI=true

RUN corepack enable

# Dependencies first, so the layer caches independently of app code changes.
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY frontend/. .
RUN pnpm run build

# --- Runtime: nginx serving the static build -----------------------------------
FROM nginx:1.31-alpine AS runtime

# The base image tag floats, so pull in current Alpine security patches
# (e.g. openssl) at build time rather than whatever shipped with the tag.
RUN apk update && apk upgrade --no-cache \
    && addgroup -S app && adduser -S app -G app \
    && rm -rf /usr/share/nginx/html/*

COPY --from=builder /app/dist/frontend/browser /usr/share/nginx/html
COPY docker/nginx/default.conf /etc/nginx/conf.d/default.conf

RUN chown -R app:app /var/cache/nginx /var/run /usr/share/nginx/html \
    && touch /var/run/nginx.pid \
    && chown app:app /var/run/nginx.pid

USER app

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
