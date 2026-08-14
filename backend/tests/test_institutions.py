"""Institution CRUD, archive/unarchive, delete guard, and ownership isolation."""

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from tests.factories import login_as, make_user


async def _authed(client: AsyncClient, db_session: AsyncSession, email: str) -> None:
    user, password = await make_user(db_session, email=email)
    await login_as(client, email=user.email, password=password)


async def test_create_and_list_institution(client: AsyncClient, db_session: AsyncSession) -> None:
    await _authed(client, db_session, "alice@example.com")

    create_response = await client.post(
        "/api/v1/institutions", json={"name": "Big Bank", "icon": "bank", "color": "#112233"}
    )
    assert create_response.status_code == 201
    body = create_response.json()
    assert body["name"] == "Big Bank"
    assert body["archived"] is False
    assert body["position"] == 0

    list_response = await client.get("/api/v1/institutions")
    assert list_response.status_code == 200
    assert any(row["id"] == body["id"] for row in list_response.json())


async def test_get_unknown_institution_is_not_found(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "bob@example.com")

    response = await client.get("/api/v1/institutions/00000000-0000-0000-0000-000000000000")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "institution.not_found"


async def test_update_institution(client: AsyncClient, db_session: AsyncSession) -> None:
    await _authed(client, db_session, "carol@example.com")
    create_response = await client.post(
        "/api/v1/institutions", json={"name": "Old Name", "icon": "bank"}
    )
    institution_id = create_response.json()["id"]

    update_response = await client.patch(
        f"/api/v1/institutions/{institution_id}", json={"name": "New Name", "position": 3}
    )
    assert update_response.status_code == 200
    body = update_response.json()
    assert body["name"] == "New Name"
    assert body["position"] == 3


async def test_archive_and_unarchive_institution(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "dave@example.com")
    create_response = await client.post(
        "/api/v1/institutions", json={"name": "Archivable", "icon": "bank"}
    )
    institution_id = create_response.json()["id"]

    archive_response = await client.post(
        f"/api/v1/institutions/{institution_id}/archive", json={"archived": True}
    )
    assert archive_response.status_code == 200
    assert archive_response.json()["archived"] is True

    unarchive_response = await client.post(
        f"/api/v1/institutions/{institution_id}/archive", json={"archived": False}
    )
    assert unarchive_response.status_code == 200
    assert unarchive_response.json()["archived"] is False


async def test_delete_institution_without_accounts_succeeds(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "erin@example.com")
    create_response = await client.post(
        "/api/v1/institutions", json={"name": "Deletable", "icon": "bank"}
    )
    institution_id = create_response.json()["id"]

    delete_response = await client.delete(f"/api/v1/institutions/{institution_id}")
    assert delete_response.status_code == 204

    get_response = await client.get(f"/api/v1/institutions/{institution_id}")
    assert get_response.status_code == 404


async def test_delete_institution_with_accounts_is_blocked(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "frank@example.com")
    institution_response = await client.post(
        "/api/v1/institutions", json={"name": "Has Accounts", "icon": "bank"}
    )
    institution_id = institution_response.json()["id"]

    account_response = await client.post(
        "/api/v1/accounts",
        json={
            "name": "Checking",
            "type": "checking",
            "currency": "BRL",
            "opening_balance": "100.0000",
            "institution_id": institution_id,
        },
    )
    assert account_response.status_code == 201

    delete_response = await client.delete(f"/api/v1/institutions/{institution_id}")
    assert delete_response.status_code == 409
    assert delete_response.json()["error"]["code"] == "institution.has_accounts"


async def test_institution_routes_require_authentication(client: AsyncClient) -> None:
    response = await client.get("/api/v1/institutions")
    assert response.status_code == 401


async def test_institution_ownership_isolation(
    client: AsyncClient, other_client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "grace@example.com")
    await _authed(other_client, db_session, "heidi@example.com")

    create_response = await client.post(
        "/api/v1/institutions", json={"name": "Grace's Bank", "icon": "bank"}
    )
    institution_id = create_response.json()["id"]

    get_response = await other_client.get(f"/api/v1/institutions/{institution_id}")
    assert get_response.status_code == 404
    assert get_response.json()["error"]["code"] == "institution.not_found"

    patch_response = await other_client.patch(
        f"/api/v1/institutions/{institution_id}", json={"name": "Hijacked"}
    )
    assert patch_response.status_code == 404

    delete_response = await other_client.delete(f"/api/v1/institutions/{institution_id}")
    assert delete_response.status_code == 404

    list_response = await other_client.get("/api/v1/institutions")
    assert list_response.status_code == 200
    assert all(row["id"] != institution_id for row in list_response.json())
