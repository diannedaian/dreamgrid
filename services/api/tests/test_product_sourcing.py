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
    ModelReply,
    OpenAIError,
    extract_cited_urls,
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
    """Returns ``reply`` for every call (or raises it). Citations only on text-mode calls."""

    def __init__(self, reply: str | Exception, cited: tuple[str, ...] = ()) -> None:
        self.reply = reply
        self.cited = cited
        self.calls: list[dict[str, Any]] = []

    async def complete(
        self,
        *,
        instructions: str,
        user_input: str,
        output: JsonSchemaFormat | None = None,
        tools: tuple[dict[str, Any], ...] = (),
    ) -> ModelReply:
        self.calls.append(
            {"input": user_input, "schema": output.name if output else None, "tools": tools}
        )
        if isinstance(self.reply, Exception):
            raise self.reply
        return ModelReply(text=self.reply, cited_urls=self.cited if output is None else ())


async def probe_all_ok(url: str) -> int | None:
    return 200


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
    assert draft.price_usd == Decimal("89")  # page price kept; the model's $1 is ignored
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


def test_llm_price_is_a_note_not_a_price() -> None:
    base = ProductDraft(source_url="https://x.example", missing=("priceUsd", "dimensionsM"))
    merged = merge_llm_facts(
        base, {"priceUsd": 89.5, "widthCm": 100, "heightCm": 75, "depthCm": 50}
    )
    assert merged.price_usd is None
    assert "priceUsd" in merged.missing
    assert merged.dimensions_m == (1.0, 0.75, 0.5)
    assert merged.note is not None and "about $89.50" in merged.note and "unverified" in merged.note


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


def test_extract_cited_urls_reads_url_citation_annotations() -> None:
    payload = {
        "output": [
            {
                "type": "message",
                "content": [
                    {
                        "type": "output_text",
                        "text": "{}",
                        "annotations": [
                            {"type": "url_citation", "url": "https://a.example/p/1"},
                            {"type": "url_citation", "url": "https://a.example/p/1"},
                            {"type": "file_citation", "file_id": "x"},
                            {"type": "url_citation", "url": "https://b.example/p/2?ref=1"},
                        ],
                    }
                ],
            }
        ]
    }
    assert extract_cited_urls(payload) == ("https://a.example/p/1", "https://b.example/p/2?ref=1")
    assert extract_cited_urls({"output": []}) == ()


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
    provider = OpenAIWebSearchProvider(model, probe=probe_all_ok)

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
    assert hit.price_usd is None  # hint only
    assert hit.note is not None and "about $120.00" in hit.note
    assert set(hit.missing) == {"priceUsd", "imageUrl"}
    # Call 1: text-mode research with the search tool. Call 2: structuring, no tools.
    assert model.calls[0]["tools"] == ({"type": "web_search"},)
    assert model.calls[0]["schema"] is None
    assert "120 cm wide" in model.calls[0]["input"]
    assert "$150" in model.calls[0]["input"]
    assert model.calls[1]["tools"] == ()
    assert model.calls[1]["schema"] == "product_search"
    assert outcome.note is None


@pytest.mark.anyio
async def test_openai_search_prompts_per_region_and_flags_conversion() -> None:
    from dreamgrid_api.adapters.commerce.search_provider import search_instructions

    assert "United States" in search_instructions("us")
    assert "converted" not in search_instructions("us")
    assert "United Kingdom" in search_instructions("uk")
    assert "pounds sterling" in search_instructions("uk")
    assert "converted" in search_instructions("uk")

    provider = OpenAIWebSearchProvider(FakeModel(json.dumps({"results": []})), probe=probe_all_ok)
    outcome = await provider.search(ProductQuery(category="lamp", region="au"), limit=3)
    assert outcome.note is not None and "converted" in outcome.note


def _hit(url: str, title: str = "Desk") -> dict[str, Any]:
    return {
        "title": title,
        "sourceUrl": url,
        "merchant": None,
        "priceUsd": 50,
        "imageUrl": None,
        "widthCm": 100,
        "heightCm": 75,
        "depthCm": 50,
        "styleTags": [],
        "colorTags": [],
    }


@pytest.mark.anyio
async def test_openai_search_keeps_only_cited_urls_and_caps_per_merchant() -> None:
    hits = [
        _hit("https://dumos.example/products/a", "A"),
        _hit("https://dumos.example/products/a?variant=2", "A dup"),
        _hit("https://dumos.example/products/b", "B"),
        _hit("https://dumos.example/products/c", "C"),
        _hit("https://www.amazon.com/dp/B1", "D"),
        _hit("https://made-up.example/products/z", "Invented"),
    ]
    cited = (
        "https://dumos.example/products/a",
        "https://dumos.example/products/b",
        "https://dumos.example/products/c",
        "https://amazon.com/dp/B1/",
    )
    provider = OpenAIWebSearchProvider(
        FakeModel(json.dumps({"results": hits}), cited=cited), probe=probe_all_ok
    )

    outcome = await provider.search(ProductQuery(category="desk"), limit=8)

    titles = [r.title for r in outcome.results]
    assert "Invented" not in titles  # not cited by the search tool
    assert "A dup" not in titles  # same page, different query string
    assert titles.count("C") == 0  # third product from the same merchant
    assert titles == ["A", "B", "D"]


@pytest.mark.anyio
async def test_openai_search_structuring_prompt_lists_only_product_page_urls() -> None:
    cited = (
        "https://www.walmart.com/c/kp/small-desk?utm_source=openai",
        "https://www.walmart.com/ip/9345372461?utm_source=openai",
        "https://www.homedepot.com/b/Desks/N-5yc1vZc7og",
        "https://www.homedepot.com/p/316788465",
    )
    model = FakeModel(json.dumps({"results": []}), cited=cited)
    provider = OpenAIWebSearchProvider(model, probe=probe_all_ok)

    await provider.search(ProductQuery(category="desk"), limit=4)

    structuring_input = model.calls[1]["input"]
    assert "walmart.com/ip/9345372461" in structuring_input
    assert "homedepot.com/p/316788465" in structuring_input
    assert "/c/kp/" not in structuring_input.split("NOTES:")[0]
    assert "/b/Desks" not in structuring_input.split("NOTES:")[0]


@pytest.mark.anyio
async def test_openai_search_gives_up_when_only_category_pages_were_cited() -> None:
    cited = ("https://www.walmart.com/c/kp/small-desk", "https://www.homedepot.com/b/Desks")
    model = FakeModel("notes", cited=cited)
    provider = OpenAIWebSearchProvider(model, probe=probe_all_ok)

    outcome = await provider.search(ProductQuery(category="desk"), limit=4)

    assert outcome.results == ()
    assert outcome.note is not None and "category pages" in outcome.note
    assert len(model.calls) == 1  # no structuring call was spent


def test_is_listing_page() -> None:
    from dreamgrid_api.adapters.commerce.search_provider import is_listing_page

    assert is_listing_page("https://www.walmart.com/c/kp/small-desk")
    assert is_listing_page("https://www.homedepot.com/b/Furniture-Desks/N-5yc1vZc7og")
    assert is_listing_page("https://www.amazon.com/s?k=desk")
    assert is_listing_page("https://store.example/")
    assert not is_listing_page("https://www.walmart.com/ip/9345372461")
    assert not is_listing_page("https://www.amazon.com/dp/B0BW8S1N3C")
    assert not is_listing_page("https://www.ebay.com/itm/387632730831")


@pytest.mark.anyio
async def test_openai_search_drops_pages_that_404() -> None:
    hits = [_hit("https://a.example/p/1", "Real"), _hit("https://b.example/p/2", "Gone")]

    async def probe(url: str) -> int | None:
        return 404 if "b.example" in url else 503  # a bot wall is not proof of a bad link

    provider = OpenAIWebSearchProvider(FakeModel(json.dumps({"results": hits})), probe=probe)
    outcome = await provider.search(ProductQuery(category="desk"), limit=8)

    assert [r.title for r in outcome.results] == ["Real"]
    assert outcome.note is not None and "no longer exist" in outcome.note


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
    assert draft.price_usd is None  # AI-reported prices are never used as prices
    assert draft.dimensions_m == (1.2, 0.75, 0.6)
    assert draft.category == "desk"
    assert draft.extraction_method == "llm"
    assert draft.missing == ("priceUsd",)
    assert draft.note is not None and "blocked" in draft.note and "about $89.99" in draft.note
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
    settings = Settings(
        environment="test", product_sourcing="auto", openai_api_key=None, serpapi_api_key=None
    )
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
    service = build_product_sourcing(
        Settings(environment="test", product_sourcing="fixture", product_search="fixture")
    )
    outcome = await service.search(ProductQuery(category="desk"))
    assert outcome.source == "fixture"
    assert len(outcome.results) == 3


def test_factory_uses_openai_when_live_and_key_present() -> None:
    settings = Settings(
        environment="test",
        product_sourcing="live",
        openai_api_key="sk-test",
        serpapi_api_key=None,
    )
    service = build_product_sourcing(settings)
    assert isinstance(service._extractor, LlmProductExtractor)  # noqa: SLF001
    assert isinstance(service._search_provider, OpenAIWebSearchProvider)  # noqa: SLF001


# --- routes -----------------------------------------------------------------


class FakeGateway:
    async def import_from_url(self, url: str, *, title_hint: str | None = None) -> ProductDraft:
        assert title_hint in (None, "Desk from a listing")
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


def test_import_route_passes_title_hint(client: TestClient) -> None:
    response = client.post(
        "/api/v1/products/import",
        json={"url": "https://shop.example/desk", "titleHint": "Desk from a listing"},
    )
    assert response.status_code == 200


@pytest.mark.anyio
async def test_lookup_receives_the_title_hint(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "dreamgrid_api.adapters.commerce.product_sourcing_service.validate_public_http_url",
        lambda url: url,
    )
    url = "https://www.google.com/search?ibp=oshop&prds=catalogid:1"
    fetcher = FakeFetcher({}, fail={url: "The store answered with HTTP 403."})
    model = FakeModel(LOOKUP_REPLY)
    service = ProductSourcingService(
        fetcher, NullProductExtractor(), fixture_search(), OpenAIUrlLookup(model)
    )

    await service.import_from_url(url, title_hint="SONGMICS Computer Desk")

    assert "Listing title: SONGMICS Computer Desk" in model.calls[0]["input"]


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
