# syntax=docker/dockerfile:1

# --- Builder: resolve dependencies into a venv with uv ------------------------
FROM python:3.13-slim AS builder

COPY --from=ghcr.io/astral-sh/uv:0.12.3 /uv /uvx /bin/

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

# Dependencies first, so the layer caches independently of app code changes.
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-install-project --no-dev

COPY app ./app
COPY alembic ./alembic
COPY alembic.ini ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev

# --- Runtime -------------------------------------------------------------------
FROM python:3.13-slim AS runtime

# Debian security patches not yet baked into the base image, and the
# system pip (unused - the app runs from the uv-managed venv below, and
# its vendored deps are what a vuln scanner flags).
RUN apt-get update && apt-get upgrade -y && apt-get clean && rm -rf /var/lib/apt/lists/* \
    && python -m pip uninstall --yes pip

RUN groupadd --system app && useradd --system --gid app --home-dir /app app

WORKDIR /app
COPY --from=builder --chown=app:app /app /app
COPY --chown=app:app docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
    # WORKDIR creates /app as root before the COPY above; --chown only
    # covers what's copied *into* it, not the directory itself. Without
    # this, celery beat can't create its schedule file in the cwd.
    && chown app:app /app

ARG APP_VERSION=dev
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    APP_VERSION=${APP_VERSION}

USER app

EXPOSE 8000

# 127.0.0.1, not localhost - some resolvers try ::1 first, which nothing
# listens on here, and the tool doing the check doesn't always fall back.
# worker/beat (same image, different CMD) override or disable this in
# docker-compose.yml since they don't run a webserver.
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health/live', timeout=2)" || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
