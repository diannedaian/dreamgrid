from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi.testclient import TestClient

from dreamgrid_api.adapters.commerce.page_fetcher import (
    HttpxPageFetcher,
    PageFetchError,
    fetch_listing_image,
    validate_public_http_url,
)
from dreamgrid_api.adapters.commerce.product_sourcing_service import build_product_sourcing
from dreamgrid_api.config import Settings
from dreamgrid_api.main import create_app


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


def test_generation_and_commerce_models_are_independent() -> None:
    settings = Settings(_env_file=None, OPENAI_API_KEY="test")
    assert settings.openai_model == "gpt-5.6-sol"
    assert settings.openai_reasoning_effort == "high"
    assert settings.commerce_openai_model == "gpt-4.1-mini"


@pytest.mark.parametrize(
    "url", ["https://user:password@example.com/x", "http://[bad", "http://example.com:bad"]
)
def test_malformed_or_credentialed_links_are_refused(url: str) -> None:
    with pytest.raises(PageFetchError):
        validate_public_http_url(url)


@pytest.mark.anyio
async def test_reader_never_follows_redirects_to_a_private_network(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("socket.getaddrinfo", lambda *args: [(2, 1, 6, "", ("93.184.216.34", 443))])
    requested: list[str] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requested.append(str(request.url))
        return httpx.Response(302, headers={"location": "http://127.0.0.1/private"})

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(respond), follow_redirects=True
    ) as client:
        with pytest.raises(PageFetchError):
            await HttpxPageFetcher(client).fetch("https://store.example/product")
    assert requested == ["https://store.example/product"]


PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


@pytest.mark.anyio
async def test_listing_photo_fetch_accepts_images_and_refuses_the_rest(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("socket.getaddrinfo", lambda *args: [(2, 1, 6, "", ("93.184.216.34", 443))])

    def respond(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/photo.png":
            return httpx.Response(200, content=PNG, headers={"content-type": "image/png"})
        if path == "/page":
            return httpx.Response(200, content=b"<html>", headers={"content-type": "text/html"})
        if path == "/huge.jpg":
            return httpx.Response(
                200, content=b"\xff" * 5_000_001, headers={"content-type": "image/jpeg"}
            )
        return httpx.Response(302, headers={"location": "http://127.0.0.1/x"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        image = await fetch_listing_image("https://cdn.example/photo.png", client)
        assert image.content_type == "image/png" and image.data == PNG
        for path in ("/page", "/huge.jpg", "/redirect"):
            with pytest.raises(PageFetchError):
                await fetch_listing_image(f"https://cdn.example{path}", client)
    for url in ("http://127.0.0.1/photo.png", "javascript:alert(1)"):
        with pytest.raises(PageFetchError):
            await fetch_listing_image(url)


def test_photo_route_returns_bytes_or_a_clean_error(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_fetch(url: str, client: object = None) -> object:
        if url.endswith("blocked"):
            raise PageFetchError("The store answered with HTTP 403.")
        from dreamgrid_api.adapters.commerce.page_fetcher import FetchedImage

        return FetchedImage(content_type="image/png", data=PNG)

    monkeypatch.setattr("dreamgrid_api.api.v1.routes.products.fetch_listing_image", fake_fetch)
    client = TestClient(create_app(Settings(_env_file=None, OPENAI_API_KEY="")))
    ok = client.get("/api/v1/products/photo", params={"url": "https://cdn.example/photo.png"})
    assert ok.status_code == 200
    assert ok.headers["content-type"] == "image/png"
    assert ok.headers["x-content-type-options"] == "nosniff"
    assert ok.content == PNG
    blocked = client.get("/api/v1/products/photo", params={"url": "https://cdn.example/blocked"})
    assert blocked.status_code == 502
    assert "403" in blocked.json()["detail"]
    assert client.get("/api/v1/products/photo").status_code == 422


@pytest.mark.anyio
async def test_invalid_links_do_not_trigger_paid_lookup() -> None:
    service = build_product_sourcing(
        Settings(_env_file=None, OPENAI_API_KEY="", product_sourcing="fixture")
    )
    lookup = AsyncMock(return_value=None)
    service._url_lookup.lookup = lookup
    draft = await service.import_from_url("http://localhost/private")
    assert draft.extraction_method == "manual"
    lookup.assert_not_awaited()
