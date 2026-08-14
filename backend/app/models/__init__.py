"""Re-exports every ORM model so importing `app.models` fully populates
`Base.metadata` for Alembic autogenerate and for the test schema fixtures.

Every new model module must be imported here, or Alembic autogenerate and
`Base.metadata.create_all` in tests will silently miss it.
"""

from app.models.currency import Currency, ExchangeRate

__all__ = [
    "Currency",
    "ExchangeRate",
]
