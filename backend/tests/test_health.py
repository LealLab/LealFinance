from httpx import AsyncClient


async def test_liveness_ok(client: AsyncClient) -> None:
    response = await client.get("/api/v1/health/live")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_readiness_ok_when_dependencies_reachable(client: AsyncClient) -> None:
    response = await client.get("/api/v1/health/ready")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["database"] is True


async def test_currencies_returns_seeded_brl(client: AsyncClient) -> None:
    response = await client.get("/api/v1/meta/currencies")
    assert response.status_code == 200
    codes = [c["code"] for c in response.json()]
    assert "BRL" in codes
