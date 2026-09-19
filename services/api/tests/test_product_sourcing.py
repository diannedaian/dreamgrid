"""Service, providers, and routes with fakes only. Nothing here touches the network."""

import json
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from dreamgrid_api.adapters.commerce.llm_product_extractor import (
    LlmProductExtractor,
    NullProductExtractor,
    merge_llm_facts,
)
from dreamgrid_api.adapters.commerce.openai_client import (
    JsonSchemaFormat,
    OpenAIError,
    extract_output_text,
    parse_json_object,
)
from dreamgrid_api.adapters.commerce.page_fetcher import (
    FetchedPage,
    PageFetchError,
    validate_public_http_url,
)
from dreamgrid_api.adapters.commerce.product_sourcing_service import (
    ProductSourcingService,
    build_product_sourcing,
)
from dreamgrid_api.adapters.commerce.search_provider import (
    FixtureSearchProvider,
    OpenAIWebSearchProvider,
)
from dreamgrid_api.adapters.commerce.url_lookup import OpenAIUrlLookup
from dreamgrid_api.boundaries.product_sourcing import (
    ProductDraft,
    ProductQuery,
    SearchOutcome,
)
from dreamgrid_api.config import Settings
from dreamgrid_api.dependencies import product_sourcing
from dreamgrid_api.main import create_app

REPO_FIXTURES = Path(__file__).resolve().parents[3] / "fixtures"

PRODUCT_PAGE = """
<html><head><title>Sage Task Chair</title>
<meta property="og:image" content="https://cdn.example/chair.jpg">
<script type="application/ld+json">
{"@type":"Product","name":"Sage Task Chair","offers":{"price":"89","priceCurrency":"USD"}}
</script></head><body><p>Seat height adjustable.</p></body></html>
"""


class FakeFetcher:
    def __init__(self, pages: dict[str, str], fail: dict[str, str] | None = None) -> None:
        self.pages = pages
        self.fail = fail or {}
        self.calls: list[str] = []

    async def fetch(self, url: str) -> FetchedPage:
        self.calls.append(url)
        if url in self.fail:
            raise PageFetchError(self.fail[url])
        return FetchedPage(requested_url=url, final_url=url, status_code=200, html=self.pages[url])


class FakeModel:
    def __init__(self, reply: str | Exception) -> None:
        self.reply = reply
        self.calls: list[dict[str, Any]] = []

    async def complete(
        self,
        *,
        instructions: str,
        user_input: str,
        output: JsonSchemaFormat,
        tools: tuple[dict[str, Any], ...] = (),
    ) -> str:
        self.calls.append({"input": user_input, "schema": output.name, "tools": tools})
        if isinstance(self.reply, Exception):
            raise self.reply
        return self.reply


class FakeSearch:
    def __init__(self, outcome: SearchOutcome) -> None:
        self.outcome = outcome
        self.calls = 0

    async def search(self, query: ProductQuery, *, limit: int) -> SearchOutcome:
        self.calls += 1
        return self.outcome


def fixture_search() -> FixtureSearchProvider:
    return FixtureSearchProvider(REPO_FIXTURES / "search-results.json")


@pytest.fixture
def anyio_backend() -> str:
    """Run async tests on asyncio only; trio is not installed."""

    return "asyncio"


# --- URL safety -------------------------------------------------------------


@pytest.mark.parametrize(
    "url",
    [
        "ftp://example.com/x",
        "file:///etc/passwd",
        "http://localhost/x",
        "http://127.0.0.1/x",
        "http://10.0.0.5/x",
        "http://192.168.1.1/x",
        "http://[::1]/x",
        "not a url",
    ],
)
def test_unsafe_urls_are_refused(url: str) -> None:
    with pytest.raises(PageFetchError):
        validate_public_http_url(url)


# --- service: import ----------------------------------------------------------


@pytest.mark.anyio
async def test_import_parses_page_and_caches(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "dreamgrid_api.adapters.commerce.product_sourcing_service.validate_public_http_url",
        lambda url: url,
    )
    fetcher = FakeFetcher({"https://shop.example/chair": PRODUCT_PAGE})
    service = ProductSourcingService(fetcher, NullProductExtractor(), fixture_search())

    first = await service.import_from_url("https://shop.example/chair")
    second = await service.import_from_url("https://shop.example/chair")

    assert first.title == "Sage Task Chair"
    assert first.price_usd == Decimal("89")
    assert first.category == "chair"
    assert first.missing == ("dimensionsM",)
    assert second is first
    assert fetcher.calls == ["https://shop.example/chair"]


@pytest.mark.anyio
async def test_blocked_page_returns_manual_draft_not_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "dreamgrid_api.adapters.commerce.product_sourcing_service.validate_public_http_url",
        lambda url: url,
    )
    fetcher = FakeFetcher(
        {}, fail={"https://www.amazon.com/dp/x": "The store answered with HTTP 403."}
    )
    service = ProductSourcingService(fetcher, NullProductExtractor(), fixture_search())

    draft = await service.import_from_url("https://www.amazon.com/dp/x")

    assert draft.extraction_method == "manual"
    assert draft.merchant == "amazon.com"
    assert draft.note is not None and "403" in draft.note
    assert "dimensionsM" in draft.missing


@pytest.mark.anyio
async def test_llm_rung_fills_only_missing_fields(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "dreamgrid_api.adapters.commerce.product_sourcing_service.validate_public_http_url",
        lambda url: url,
    )
    model = FakeModel(
        json.dumps(
            {
                "title": "WRONG",
                "priceUsd": 1,
                "widthCm": 58,
                "heightCm": 92,
                "depthCm": 61,
                "category": "chair",
                "styleTags": ["Soft", "modern", "soft"],
                "colorTags": ["sage"],
            }
        )
    )
    fetcher = FakeFetcher({"https://shop.example/chair": PRODUCT_PAGE})
    service = ProductSourcingService(fetcher, LlmProductExtractor(model), fixture_search())

    draft = await service.import_from_url("https://shop.example/chair")

    assert draft.title == "Sage Task Chair"  # structured data wins
    assert draft.price_usd == Decimal("89")
    assert draft.dimensions_m == (0.58, 0.92, 0.61)
    assert draft.extraction_method == "llm"
    assert draft.missing == ()
    assert draft.style_tags == ("soft", "modern")
    assert model.calls[0]["schema"] == "product_facts"
    assert "Sage Task Chair" in model.calls[0]["input"]


@pytest.mark.anyio
async def test_llm_failure_keeps_the_pattern_draft() -> None:
    base = ProductDraft(source_url="https://x.example", title="X", missing=("priceUsd",))
    extractor = LlmProductExtractor(FakeModel(OpenAIError("OpenAI answered HTTP 429.")))

    draft = await extractor.extract(base, "some text")

    assert draft.title == "X"
    assert draft.missing == ("priceUsd",)
    assert draft.note is not None and "429" in draft.note


def test_merge_llm_facts_ignores_garbage() -> None:
    base = ProductDraft(
        source_url="https://x.example", missing=("priceUsd", "dimensionsM", "category")
    )
    merged = merge_llm_facts(base, {"priceUsd": "cheap", "widthCm": -1, "category": "sofa"})
    assert merged.price_usd is None
    assert merged.dimensions_m is None
    assert merged.category is None
    assert merged.extraction_method == "manual"


# --- OpenAI client helpers ------------------------------------------------------


def test_extract_output_text_reads_responses_payload() -> None:
    payload = {
        "output": [
            {"type": "web_search_call"},
            {"type": "message", "content": [{"type": "output_text", "text": '{"a": 1}'}]},
        ]
    }
    assert extract_output_text(payload) == '{"a": 1}'
    with pytest.raises(OpenAIError):
        extract_output_text({"output": []})


def test_parse_json_object_tolerates_fences_and_prose() -> None:
    assert parse_json_object('```json\n{"a": 1}\n```') == {"a": 1}
    assert parse_json_object('Here you go: {"a": 1} done') == {"a": 1}
    with pytest.raises(OpenAIError):
        parse_json_object("[1, 2]")


# --- search --------------------------------------------------------------------


@pytest.mark.anyio
async def test_fixture_search_filters_by_category_and_limits() -> None:
    outcome = await fixture_search().search(ProductQuery(category="desk"), limit=2)

    assert outcome.source == "fixture"
    assert len(outcome.results) == 2
    assert all(r.category == "desk" for r in outcome.results)
    assert all(r.extraction_method == "fixture" for r in outcome.results)
    assert outcome.results[0].dimensions_m == (0.8, 0.5, 0.45)


@pytest.mark.anyio
async def test_fixture_search_handles_missing_file(tmp_path: Path) -> None:
    outcome = await FixtureSearchProvider(tmp_path / "nope.json").search(
        ProductQuery(category="lamp"), limit=5
    )
    assert outcome.results == ()
    assert outcome.note is not None


@pytest.mark.anyio
async def test_openai_search_maps_hits_and_skips_bad_urls() -> None:
    model = FakeModel(
        json.dumps(
            {
                "results": [
                    {
                        "title": "Desk A",
                        "sourceUrl": "https://a.example/desk",
                        "merchant": None,
                        "priceUsd": 120,
                        "imageUrl": None,
                        "widthCm": 120,
                        "heightCm": 75,
                        "depthCm": 60,
                        "styleTags": ["minimal"],
                        "colorTags": [],
                    },
                    {
                        "title": "Bad",
                        "sourceUrl": "javascript:alert(1)",
                        "merchant": None,
                        "priceUsd": 1,
                        "imageUrl": None,
                        "widthCm": None,
                        "heightCm": None,
                        "depthCm": None,
                        "styleTags": [],
                        "colorTags": [],
                    },
                ]
            }
        )
    )
    provider = OpenAIWebSearchProvider(model)

    outcome = await provider.search(
        ProductQuery(
            category="desk", target_dimensions_m=(1.2, 0.75, 0.6), max_price_usd=Decimal("150")
        ),
        limit=5,
    )

    assert outcome.source == "live"
    assert len(outcome.results) == 1
    hit = outcome.results[0]
    assert hit.merchant == "a.example"
    assert hit.dimensions_m == (1.2, 0.75, 0.6)
    assert hit.price_usd == Decimal("120")
    assert hit.missing == ("imageUrl",)
    assert model.calls[0]["tools"] == ({"type": "web_search"},)
    assert "120 cm wide" in model.calls[0]["input"]
    assert "$150" in model.calls[0]["input"]
    assert outcome.note is None


@pytest.mark.anyio
async def test_openai_search_prompts_per_region_and_flags_conversion() -> None:
    from dreamgrid_api.adapters.commerce.search_provider import search_instructions

    assert "United States" in search_instructions("us")
    assert "converted" not in search_instructions("us")
    assert "United Kingdom" in search_instructions("uk")
    assert "pounds sterling" in search_instructions("uk")
    assert "converted" in search_instructions("uk")

    provider = OpenAIWebSearchProvider(FakeModel(json.dumps({"results": []})))
    outcome = await provider.search(ProductQuery(category="lamp", region="au"), limit=3)
    assert outcome.note is not None and "converted" in outcome.note


@pytest.mark.anyio
async def test_openai_search_failure_is_a_note_not_an_exception() -> None:
    provider = OpenAIWebSearchProvider(FakeModel(OpenAIError("OpenAI answered HTTP 500.")))
    outcome = await provider.search(ProductQuery(category="desk"), limit=3)
    assert outcome.results == ()
    assert outcome.note is not None and "500" in outcome.note


@pytest.mark.anyio
async def test_service_caches_non_empty_search_results() -> None:
    search = FakeSearch(
        SearchOutcome(results=(ProductDraft(source_url="https://a.example"),), source="live")
    )
    service = ProductSourcingService(FakeFetcher({}), NullProductExtractor(), search)
    query = ProductQuery(category="lamp", keywords="  Warm ")

    await service.search(query)
    await service.search(ProductQuery(category="lamp", keywords="warm"))

    assert search.calls == 1


# --- blocked page -> web-search lookup -------------------------------------------


LOOKUP_REPLY = json.dumps(
    {
        "found": True,
        "title": "SONGMICS Computer Desk",
        "priceUsd": 89.99,
        "merchant": "Amazon",
        "imageUrl": "https://m.media-amazon.com/x.jpg",
        "widthCm": 120,
        "heightCm": 75,
        "depthCm": 60,
        "category": "desk",
        "styleTags": ["Modern"],
        "colorTags": ["black"],
    }
)

NOT_FOUND_REPLY = json.dumps(
    {
        "found": False,
        "title": None,
        "priceUsd": None,
        "merchant": None,
        "imageUrl": None,
        "widthCm": None,
        "heightCm": None,
        "depthCm": None,
        "category": None,
        "styleTags": [],
        "colorTags": [],
    }
)


@pytest.mark.anyio
async def test_blocked_fetch_falls_back_to_lookup(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "dreamgrid_api.adapters.commerce.product_sourcing_service.validate_public_http_url",
        lambda url: url,
    )
    url = "https://www.amazon.com/dp/B07ABCDEFG"
    fetcher = FakeFetcher({}, fail={url: "The store answered with HTTP 503."})
    model = FakeModel(LOOKUP_REPLY)
    service = ProductSourcingService(
        fetcher, NullProductExtractor(), fixture_search(), OpenAIUrlLookup(model)
    )

    draft = await service.import_from_url(url)
    again = await service.import_from_url(url)

    assert draft.title == "SONGMICS Computer Desk"
    assert draft.price_usd == Decimal("89.99")
    assert draft.dimensions_m == (1.2, 0.75, 0.6)
    assert draft.category == "desk"
    assert draft.extraction_method == "llm"
    assert draft.missing == ()
    assert draft.note is not None and "blocked" in draft.note
    assert "B07ABCDEFG" in model.calls[0]["input"]
    assert model.calls[0]["tools"] == ({"type": "web_search"},)
    assert again is draft and len(model.calls) == 1  # cached


@pytest.mark.anyio
async def test_javascript_shell_also_triggers_lookup(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "dreamgrid_api.adapters.commerce.product_sourcing_service.validate_public_http_url",
        lambda url: url,
    )
    url = "https://www.ikea.com/us/en/p/x"
    shell = "<html><head><title>Products</title></head><body><div id=app></div></body></html>"
    service = ProductSourcingService(
        FakeFetcher({url: shell}),
        NullProductExtractor(),
        fixture_search(),
        OpenAIUrlLookup(FakeModel(LOOKUP_REPLY)),
    )

    draft = await service.import_from_url(url)

    assert draft.extraction_method == "llm"
    assert draft.title == "SONGMICS Computer Desk"


@pytest.mark.anyio
async def test_lookup_not_found_or_failing_yields_manual_draft(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "dreamgrid_api.adapters.commerce.product_sourcing_service.validate_public_http_url",
        lambda url: url,
    )
    url = "https://www.amazon.com/dp/B0NOTFOUND"
    fetcher = FakeFetcher({}, fail={url: "The store answered with HTTP 503."})
    service = ProductSourcingService(
        fetcher,
        NullProductExtractor(),
        fixture_search(),
        OpenAIUrlLookup(FakeModel(NOT_FOUND_REPLY)),
    )
    draft = await service.import_from_url(url)
    assert draft.extraction_method == "manual"
    assert draft.note is not None and "503" in draft.note

    failing = OpenAIUrlLookup(FakeModel(OpenAIError("OpenAI answered HTTP 500.")))
    service = ProductSourcingService(fetcher, NullProductExtractor(), fixture_search(), failing)
    draft = await service.import_from_url(url)
    assert draft.extraction_method == "manual"


# --- settings / factory -----------------------------------------------------


def test_factory_defaults_to_fixture_components_without_a_key() -> None:
    settings = Settings(environment="test", product_sourcing="auto", openai_api_key=None)
    service = build_product_sourcing(settings)
    assert not settings.sourcing_is_live
    assert isinstance(service, ProductSourcingService)
    assert isinstance(service._extractor, NullProductExtractor)  # noqa: SLF001
    assert isinstance(service._search_provider, FixtureSearchProvider)  # noqa: SLF001


def test_auto_mode_goes_live_when_a_key_is_present() -> None:
    settings = Settings(environment="test", product_sourcing="auto", openai_api_key="sk-test")
    assert settings.sourcing_is_live
    service = build_product_sourcing(settings)
    assert isinstance(service._url_lookup, OpenAIUrlLookup)  # noqa: SLF001


def test_fixture_mode_ignores_a_present_key() -> None:
    settings = Settings(environment="test", product_sourcing="fixture", openai_api_key="sk-test")
    assert not settings.sourcing_is_live


@pytest.mark.anyio
async def test_default_fixture_path_points_at_the_repo_fixtures() -> None:
    service = build_product_sourcing(Settings(environment="test", product_sourcing="fixture"))
    outcome = await service.search(ProductQuery(category="desk"))
    assert outcome.source == "fixture"
    assert len(outcome.results) == 3


def test_factory_uses_openai_when_live_and_key_present() -> None:
    settings = Settings(environment="test", product_sourcing="live", openai_api_key="sk-test")
    service = build_product_sourcing(settings)
    assert isinstance(service._extractor, LlmProductExtractor)  # noqa: SLF001
    assert isinstance(service._search_provider, OpenAIWebSearchProvider)  # noqa: SLF001


# --- routes -----------------------------------------------------------------


class FakeGateway:
    async def import_from_url(self, url: str) -> ProductDraft:
        return ProductDraft(
            source_url=url,
            title="Desk",
            price_usd=Decimal("49.99"),
            merchant="shop.example",
            dimensions_m=(1.2, 0.74, 0.6),
            category="desk",
            style_tags=("minimal",),
            confidence=0.8,
            extraction_method="structured-data",
            missing=("imageUrl",),
        )

    async def search(self, query: ProductQuery, *, limit: int = 8) -> SearchOutcome:
        assert query.max_price_usd == Decimal("43")
        assert query.style_tags == ("cozy",)
        assert query.region == "uk"
        return SearchOutcome(
            results=(
                ProductDraft(
                    source_url="https://a.example",
                    title="A",
                    category=query.category,
                    extraction_method="fixture",
                    missing=(),
                ),
            ),
            source="fixture",
            note="demo",
        )


@pytest.fixture
def client() -> TestClient:
    app = create_app(Settings(environment="test"))
    app.dependency_overrides[product_sourcing] = lambda: FakeGateway()
    return TestClient(app)


def test_import_route_returns_camel_case_draft(client: TestClient) -> None:
    response = client.post("/api/v1/products/import", json={"url": "https://shop.example/desk"})

    assert response.status_code == 200
    body = response.json()
    assert body["sourceUrl"] == "https://shop.example/desk"
    assert body["priceUsd"] == 49.99
    assert body["dimensionsM"] == [1.2, 0.74, 0.6]
    assert body["extractionMethod"] == "structured-data"
    assert body["missing"] == ["imageUrl"]
    assert body["styleTags"] == ["minimal"]


def test_import_route_rejects_empty_url(client: TestClient) -> None:
    assert client.post("/api/v1/products/import", json={"url": ""}).status_code == 422


def test_search_route_translates_query_and_results(client: TestClient) -> None:
    response = client.post(
        "/api/v1/products/search",
        json={
            "category": "lamp",
            "maxPriceUsd": 43,
            "styleTags": [" Cozy "],
            "region": "uk",
            "limit": 3,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "fixture"
    assert body["note"] == "demo"
    assert body["results"][0]["title"] == "A"
    assert body["results"][0]["category"] == "lamp"


def test_search_route_rejects_unknown_category(client: TestClient) -> None:
    assert client.post("/api/v1/products/search", json={"category": "sofa"}).status_code == 422


def test_search_route_rejects_unknown_region(client: TestClient) -> None:
    body = {"category": "lamp", "region": "mars"}
    assert client.post("/api/v1/products/search", json=body).status_code == 422


def test_openapi_lists_product_routes(client: TestClient) -> None:
    paths = client.get("/openapi.json").json()["paths"]
    assert "/api/v1/products/import" in paths
    assert "/api/v1/products/search" in paths
