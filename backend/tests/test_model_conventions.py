"""Structural guardrails over the ORM model layer.

Not business logic - proof that every domain model actually is what
app/services/ownership.py assumes it is, so a model that forgets to
subclass UserOwnedModel (app/models/base.py) fails CI on the day it's
written, rather than surfacing later as a cross-user data leak.
"""

from app import models  # noqa: F401 - populates Base.registry.mappers
from app.models.base import Base, UserOwnedModel

# The only tables that are intentionally NOT scoped to a single user.
_GLOBAL_MODELS = {"Currency", "ExchangeRate", "AssetQuote", "User", "Session", "Invitation"}


def test_every_domain_model_is_user_owned_or_explicitly_global() -> None:
    for mapper in Base.registry.mappers:
        model = mapper.class_
        if model.__name__ in _GLOBAL_MODELS:
            assert not issubclass(model, UserOwnedModel), (
                f"{model.__name__} is in the global-model allowlist but "
                "subclasses UserOwnedModel - update the allowlist or the model."
            )
            continue
        assert issubclass(model, UserOwnedModel), (
            f"{model.__name__} is not in the global-model allowlist and must "
            "subclass UserOwnedModel so the ownership-scoping helpers in "
            "app/services/ownership.py cover it."
        )


def test_every_user_owned_model_declares_an_error_prefix() -> None:
    for mapper in Base.registry.mappers:
        model = mapper.class_
        if not issubclass(model, UserOwnedModel):
            continue
        assert getattr(model, "__error_prefix__", None), (
            f"{model.__name__} subclasses UserOwnedModel but has no "
            "__error_prefix__ - app/services/ownership.py needs one to "
            "build a domain-specific 404 error code."
        )
