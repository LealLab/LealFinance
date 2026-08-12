"""Sync database engine for Celery workers.

Celery tasks run outside FastAPI's event loop, so they use plain psycopg
(sync) rather than the async engine in db.py.
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings

settings = get_settings()

# psycopg (v3) supports both sync and async under the same "postgresql+psycopg"
# driver name, so the URL from settings is reused as-is.
sync_engine = create_engine(
    settings.sqlalchemy_database_uri,
    pool_pre_ping=True,
    echo=False,
)

SyncSessionLocal: sessionmaker[Session] = sessionmaker(bind=sync_engine, expire_on_commit=False)
