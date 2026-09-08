"""SMTP send path for invitation email.

Follows tests/test_exchange_rates.py: the low-level client is monkeypatched,
nothing touches the network.
"""

import smtplib

import pytest

from app.core.config import get_settings
from app.services.email import build_invitation_email, send_email


class _FakeSMTP:
    """Records what send_email did instead of talking to a server."""

    instances: list["_FakeSMTP"] = []

    def __init__(self, host: str, port: int, timeout: float | None = None) -> None:
        self.host = host
        self.port = port
        self.timeout = timeout
        self.started_tls = False
        self.login_args: tuple[str, str] | None = None
        self.sent: list[object] = []
        _FakeSMTP.instances.append(self)

    def __enter__(self) -> "_FakeSMTP":
        return self

    def __exit__(self, *exc: object) -> bool:
        return False

    def starttls(self) -> None:
        self.started_tls = True

    def login(self, user: str, password: str) -> None:
        self.login_args = (user, password)

    def send_message(self, message: object) -> None:
        self.sent.append(message)


@pytest.fixture
def smtp_config(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "smtp_host", "smtp.example.com")
    monkeypatch.setattr(settings, "smtp_port", 2525)
    monkeypatch.setattr(settings, "smtp_username", "postbox")
    monkeypatch.setattr(settings, "smtp_password", "secret")
    monkeypatch.setattr(settings, "smtp_from", "no-reply@example.com")
    monkeypatch.setattr(settings, "smtp_starttls", True)
    monkeypatch.setattr(settings, "app_base_url", "https://finance.example.test")


@pytest.fixture
def fake_smtp(monkeypatch: pytest.MonkeyPatch) -> type[_FakeSMTP]:
    _FakeSMTP.instances.clear()
    monkeypatch.setattr(smtplib, "SMTP", _FakeSMTP)
    return _FakeSMTP


def test_send_email_is_a_noop_without_smtp(fake_smtp: type[_FakeSMTP]) -> None:
    send_email(to="someone@example.com", subject="Hi", body="Body")
    assert fake_smtp.instances == []


def test_send_email_delivers_when_configured(smtp_config: None, fake_smtp: type[_FakeSMTP]) -> None:
    send_email(
        to="invitee@example.com",
        subject="Hello",
        body="Body text",
        html="<p>Body <b>text</b></p>",
    )

    assert len(fake_smtp.instances) == 1
    smtp = fake_smtp.instances[0]
    assert (smtp.host, smtp.port) == ("smtp.example.com", 2525)
    assert smtp.timeout is not None
    assert smtp.started_tls is True
    assert smtp.login_args == ("postbox", "secret")
    assert len(smtp.sent) == 1
    message = smtp.sent[0]
    assert message["To"] == "invitee@example.com"  # type: ignore[index]
    # From carries a display name so the client shows "LealFinance", not a
    # bare address.
    assert message["From"] == "LealFinance <no-reply@example.com>"  # type: ignore[index]
    assert message["Subject"] == "Hello"  # type: ignore[index]
    plain = message.get_body(preferencelist=("plain",))  # type: ignore[attr-defined]
    html_part = message.get_body(preferencelist=("html",))  # type: ignore[attr-defined]
    assert plain is not None and plain.get_content().strip() == "Body text"
    assert html_part is not None and "<b>text</b>" in html_part.get_content()


def test_send_email_swallows_smtp_errors(
    smtp_config: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    def _boom(*args: object, **kwargs: object) -> None:
        raise smtplib.SMTPException("refused")

    monkeypatch.setattr(smtplib, "SMTP", _boom)
    send_email(to="x@example.com", subject="s", body="b")  # must not raise


def test_build_invitation_email_link_matches_the_frontend_query_shape(smtp_config: None) -> None:
    subject, text, html = build_invitation_email(email="new@example.com", token="tok-123")
    link = "https://finance.example.test/register?email=new%40example.com&token=tok-123"

    assert "LealFinance" in subject
    assert link in text
    # HTML has it in the button href (& escaped) and again as the visible
    # fallback line.
    assert link.replace("&", "&amp;") in html
    assert "Create your account" in html
    assert "the button doesn't work" in html
