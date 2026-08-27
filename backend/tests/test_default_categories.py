"""Registration seeds translated default category groups and categories."""

import json
from pathlib import Path

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession


def _default_names(locale: str) -> tuple[set[str], set[str]]:
    data = json.loads(
        (Path(__file__).parents[1] / "app" / "data" / "default_categories.json").read_text(
            encoding="utf-8"
        )
    )
    names = data["names"][locale]
    group_names = {names[group["key"]] for group in data["structure"]}
    category_names = {
        names[category["key"]] for group in data["structure"] for category in group["categories"]
    }
    return group_names, category_names


async def test_registration_seeds_localized_and_fallback_defaults(
    client: AsyncClient, other_client: AsyncClient, db_session: AsyncSession
) -> None:
    register_response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "german@example.com",
            "password": "a-perfectly-fine-password",
            "display_name": "German User",
            "locale": "de-DE",
        },
    )
    assert register_response.status_code == 201, register_response.text
    client.headers["X-XSRF-TOKEN"] = client.cookies["XSRF-TOKEN"]

    groups_response = await client.get("/api/v1/category-groups")
    categories_response = await client.get("/api/v1/categories")
    assert groups_response.status_code == 200
    assert categories_response.status_code == 200
    german_groups, german_categories = _default_names("de-DE")
    assert len(groups_response.json()) == 8
    assert len(categories_response.json()) == 27
    assert {row["name"] for row in groups_response.json()} == german_groups
    assert {row["name"] for row in categories_response.json()} == german_categories
    assert "Wohnen" in {row["name"] for row in groups_response.json()}
    assert "Miete" in {row["name"] for row in categories_response.json()}

    invitation_response = await client.post(
        "/api/v1/auth/invitations", json={"email": "fallback@example.com", "role": "member"}
    )
    assert invitation_response.status_code == 201
    fallback_register_response = await other_client.post(
        "/api/v1/auth/register",
        json={
            "email": "fallback@example.com",
            "token": invitation_response.json()["token"],
            "password": "a-perfectly-fine-password",
            "display_name": "Fallback User",
            "locale": "xx-XX",
        },
    )
    assert fallback_register_response.status_code == 201, fallback_register_response.text

    fallback_groups_response = await other_client.get("/api/v1/category-groups")
    fallback_categories_response = await other_client.get("/api/v1/categories")
    assert fallback_groups_response.status_code == 200
    assert fallback_categories_response.status_code == 200
    english_groups, english_categories = _default_names("en-US")
    assert len(fallback_groups_response.json()) == 8
    assert len(fallback_categories_response.json()) == 27
    assert {row["name"] for row in fallback_groups_response.json()} == english_groups
    assert {row["name"] for row in fallback_categories_response.json()} == english_categories
    assert "Housing" in {row["name"] for row in fallback_groups_response.json()}
    assert "Rent" in {row["name"] for row in fallback_categories_response.json()}
