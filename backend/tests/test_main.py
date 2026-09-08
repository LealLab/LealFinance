from httpx import ASGITransport, AsyncClient

from app.main import create_app


async def test_unexpected_exception_uses_internal_error_body() -> None:
    test_app = create_app()

    async def explode() -> None:
        raise RuntimeError("boom")

    test_app.add_api_route("/test-unexpected", explode)
    transport = ASGITransport(app=test_app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/test-unexpected")

    assert response.status_code == 500
    assert response.json() == {"error": {"code": "error.internal", "params": {}}}
