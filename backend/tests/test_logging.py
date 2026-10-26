import logging

import pytest

from app.core.logging import configure_logging


@pytest.fixture
def restore_logging():
    root = logging.getLogger()
    names = ("uvicorn.access", "sqlalchemy.engine", "httpx", "httpcore")
    saved_handlers, saved_level = list(root.handlers), root.level
    saved_levels = {name: logging.getLogger(name).level for name in names}
    yield
    root.handlers[:] = saved_handlers
    root.setLevel(saved_level)
    for name, level in saved_levels.items():
        logging.getLogger(name).setLevel(level)


def test_http_client_loggers_do_not_log_request_urls_at_info(restore_logging) -> None:
    """httpx logs full URLs at INFO; provider API keys travel in query strings."""
    configure_logging("INFO")

    for name in ("httpx", "httpcore", "uvicorn.access", "sqlalchemy.engine"):
        assert logging.getLogger(name).getEffectiveLevel() >= logging.WARNING
