"""Small async client for the Pluggy REST API."""

from datetime import date as date_type
from typing import Any, Literal, cast

import httpx

from app.core.errors import ValidationAppError

_BASE_URL = "https://api.pluggy.ai"
_TIMEOUT = 10
_Payload = dict[str, Any]
_ResponseData = _Payload | list[_Payload]
_Method = Literal["GET", "POST", "PATCH", "DELETE"]


async def _request(
    method: _Method,
    path: str,
    *,
    api_key: str | None = None,
    json: dict[str, str] | None = None,
    params: dict[str, str] | None = None,
) -> _ResponseData:
    headers = {"X-API-KEY": api_key} if api_key is not None else {}
    url = f"{_BASE_URL}{path}"

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            if method == "GET":
                response = await client.get(url, headers=headers, params=params)
            elif method == "POST":
                response = await client.post(url, headers=headers, json=json)
            elif method == "PATCH":
                response = await client.patch(url, headers=headers)
            else:
                response = await client.delete(url, headers=headers)
            response.raise_for_status()
    except httpx.HTTPError as exc:
        raise ValidationAppError(code="pluggy.request_failed") from exc

    if response.status_code == 204:
        return {}
    try:
        payload = response.json()
    except (TypeError, ValueError) as exc:
        raise ValidationAppError(code="pluggy.request_failed") from exc
    if isinstance(payload, dict):
        return cast(_Payload, payload)
    if isinstance(payload, list) and all(isinstance(item, dict) for item in payload):
        return cast(list[_Payload], payload)
    raise ValidationAppError(code="pluggy.request_failed")


def _object_payload(payload: _ResponseData) -> _Payload:
    if not isinstance(payload, dict):
        raise ValidationAppError(code="pluggy.request_failed")
    return payload


async def authenticate(client_id: str, client_secret: str) -> str:
    payload = _object_payload(
        await _request(
            "POST",
            "/auth",
            json={"clientId": client_id, "clientSecret": client_secret},
        )
    )
    api_key = payload.get("apiKey")
    if not isinstance(api_key, str) or not api_key:
        raise ValidationAppError(code="pluggy.request_failed")
    return api_key


async def create_connect_token(api_key: str, item_id: str | None = None) -> str:
    payload = _object_payload(
        await _request(
            "POST",
            "/connect_token",
            api_key=api_key,
            json={} if item_id is None else {"itemId": item_id},
        )
    )
    token = payload.get("accessToken")
    if not isinstance(token, str) or not token:
        raise ValidationAppError(code="pluggy.request_failed")
    return token


async def get_item(api_key: str, item_id: str) -> _Payload:
    return _object_payload(await _request("GET", f"/items/{item_id}", api_key=api_key))


async def trigger_item_update(api_key: str, item_id: str) -> _Payload:
    return _object_payload(await _request("PATCH", f"/items/{item_id}", api_key=api_key))


async def delete_item(api_key: str, item_id: str) -> None:
    await _request("DELETE", f"/items/{item_id}", api_key=api_key)


async def get_connector(api_key: str, connector_id: int) -> _Payload:
    return _object_payload(await _request("GET", f"/connectors/{connector_id}", api_key=api_key))


async def list_accounts(api_key: str, item_id: str) -> list[_Payload]:
    payload = await _request("GET", "/accounts", api_key=api_key, params={"itemId": item_id})
    if isinstance(payload, list):
        return payload
    results = payload.get("results")
    if not isinstance(results, list) or not all(isinstance(item, dict) for item in results):
        raise ValidationAppError(code="pluggy.request_failed")
    return cast(list[_Payload], results)


async def get_transactions(
    api_key: str,
    account_id: str,
    from_date: date_type,
    to_date: date_type,
    page: int,
) -> _Payload:
    return _object_payload(
        await _request(
            "GET",
            "/transactions",
            api_key=api_key,
            params={
                "accountId": account_id,
                "from": from_date.isoformat(),
                "to": to_date.isoformat(),
                "page": str(page),
            },
        )
    )


async def get_investments(api_key: str, item_id: str) -> _Payload:
    return _object_payload(
        await _request("GET", "/investments", api_key=api_key, params={"itemId": item_id})
    )


async def get_loans(api_key: str, item_id: str) -> _Payload:
    return _object_payload(
        await _request("GET", "/loans", api_key=api_key, params={"itemId": item_id})
    )
