"""SerpAPI Google Shopping provider with a mocked transport. No network."""

import json
from decimal import Decimal

import httpx
import pytest

from dreamgrid_api.adapters.commerce.product_sourcing_service import build_product_sourcing
from dreamgrid_api.adapters.commerce.search_provider import (
    FixtureSearchProvider,
    OpenAIWebSearchProvider,
)
from dreamgrid_api.adapters.commerce.serpapi_search_provider import (
    SerpApiShoppingProvider,
    build_params,
    draft_from_listing,
)
from dreamgrid_api.boundaries.product_sourcing import ProductQuery
from dreamgrid_api.config import Settings

LISTINGS = {
    "shopping_results": [
        {
            "position": 1,
            "title": 'BEAUTYPEAK 31" Small Computer Desk',
            "link": "https://www.walmart.com/ip/BEAUTYPEAK-31-Small-Computer-Desk/5029211387",
            "product_link": "https://www.google.com/shopping/product/123",
            "source": "Walmart",
            "price": "$27.88",
            "extracted_price": 27.88,
            "thumbnail": "https://encrypted-tbn0.gstatic.com/shopping?q=abc",
        },
        {
            "position": 2,
            "title": "Google-only listing",
            "link": "https://www.google.com/shopping/product/456",
            "product_link": "https://www.google.com/shopping/product/456",
            "source": "Somewhere",
            "extracted_price": 30,
        },
        {"position": 3, "title": "No link at all", "extracted_price": 10},
        {
            "position": 4,
            "title": "Duplicate of first",
            "link": "https://www.walmart.com/ip/BEAUTYPEAK-31-Small-Computer-Desk/5029211387",
            "extracted_price": 27.88,
        },
        {
            "position": 5,
            "title": "IKEA TORALD Desk",
            "link": "https://www.ikea.com/us/en/p/torald-desk-white-30501304/",
            "source": "IKEA",
            "price": "$29.99",
            "extracted_price": 29.99,
            "thumbnail": "https://www.ikea.com/x.jpg",
        },
    ]
}


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


def make_provider(handler: httpx.MockTransport) -> SerpApiShoppingProvider:
    return SerpApiShoppingProvider("test-key", client=httpx.AsyncClient(transport=handler))


def test_build_params_uses_region_and_price_filter() -> None:
    query = ProductQuery(category="desk", keywords="small", max_price_usd=Decimal("43"))
    params = build_params(query, "k", limit=6)

    assert params["engine"] == "google_shopping"
    assert params["q"] == "small desk under $43"
    assert params["gl"] == "us"
    assert params["tbs"] == "mr:1,price:1,ppr_max:43"
    assert params["api_key"] == "k"

    uk = build_params(
        ProductQuery(category="lamp", region="uk", max_price_usd=Decimal("9")), "k", 4
    )
    assert uk["gl"] == "uk"
    assert uk["q"] == "lamp"
    assert "tbs" not in uk  # price filter is USD-only


def test_within_budget_results_come_first_and_sellers_collapse() -> None:
    from dreamgrid_api.adapters.commerce.serpapi_search_provider import (
        listing_key,
        order_within_budget_first,
    )

    cheap = draft_from_listing(LISTINGS["shopping_results"][4], ProductQuery(category="desk"))
    pricey = draft_from_listing(
        {**LISTINGS["shopping_results"][0], "extracted_price": 169.25},
        ProductQuery(category="desk"),
    )
    assert cheap is not None and pricey is not None
    assert order_within_budget_first([pricey, cheap], Decimal("43")) == [cheap, pricey]
    assert order_within_budget_first([pricey, cheap], None) == [pricey, cheap]

    google_page = "https://www.google.com/search?ibp=oshop&q=x&prds=catalogid:122205,pid:1"
    a = draft_from_listing({"title": "Desk A", "link": google_page}, ProductQuery(category="desk"))
    b = draft_from_listing(
        {"title": "Desk A", "link": google_page + "&s=2"}, ProductQuery(category="desk")
    )
    assert a is not None and b is not None
    assert listing_key({"title": "Desk A"}, a) == listing_key({"title": "Desk A"}, b) == "id:122205"
    assert listing_key({"product_id": "999"}, a) == "id:999"


def test_draft_prefers_merchant_link_over_google_product_page() -> None:
    draft = draft_from_listing(LISTINGS["shopping_results"][0], ProductQuery(category="desk"))
    assert draft is not None
    assert draft.source_url.startswith("https://www.walmart.com/ip/")
    assert draft.price_usd == Decimal("27.88")
    assert draft.merchant == "Walmart"
    assert draft.image_url is not None
    assert draft.category == "desk"
    assert draft.missing == ("dimensionsM",)

    google_only = draft_from_listing(LISTINGS["shopping_results"][1], ProductQuery(category="desk"))
    assert google_only is not None
    assert "google.com/shopping" in google_only.source_url

    assert (
        draft_from_listing(LISTINGS["shopping_results"][2], ProductQuery(category="desk")) is None
    )


def test_non_us_prices_are_not_reported_as_usd() -> None:
    draft = draft_from_listing(
        LISTINGS["shopping_results"][0], ProductQuery(category="desk", region="uk")
    )
    assert draft is not None
    assert draft.price_usd is None
    assert "priceUsd" in draft.missing
    assert draft.note is not None and "local currency" in draft.note


@pytest.mark.anyio
async def test_provider_maps_and_dedupes_listings() -> None:
    seen_requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_requests.append(request)
        return httpx.Response(200, json=LISTINGS)

    provider = make_provider(httpx.MockTransport(handler))
    outcome = await provider.search(
        ProductQuery(category="desk", keywords="small", max_price_usd=Decimal("43")), limit=6
    )

    assert outcome.provider == "serpapi"
    assert outcome.source == "live"
    assert [d.title for d in outcome.results] == [
        'BEAUTYPEAK 31" Small Computer Desk',
        "Google-only listing",
        "IKEA TORALD Desk",
    ]
    assert outcome.note is None
    assert seen_requests[0].url.host == "serpapi.com"
    assert "api_key=test-key" in str(seen_requests[0].url)


@pytest.mark.anyio
async def test_provider_respects_limit_and_reports_empty() -> None:
    provider = make_provider(httpx.MockTransport(lambda r: httpx.Response(200, json=LISTINGS)))
    outcome = await provider.search(ProductQuery(category="desk"), limit=1)
    assert len(outcome.results) == 1

    empty = make_provider(
        httpx.MockTransport(lambda r: httpx.Response(200, json={"shopping_results": []}))
    )
    outcome = await empty.search(ProductQuery(category="desk"), limit=5)
    assert outcome.results == ()
    assert outcome.note is not None and "No Google Shopping" in outcome.note


@pytest.mark.anyio
async def test_provider_failures_become_notes_not_exceptions() -> None:
    forbidden = make_provider(
        httpx.MockTransport(lambda r: httpx.Response(401, json={"error": "bad key"}))
    )
    outcome = await forbidden.search(ProductQuery(category="desk"), limit=5)
    assert outcome.results == () and outcome.note is not None and "401" in outcome.note

    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down", request=request)

    down = make_provider(httpx.MockTransport(boom))
    outcome = await down.search(ProductQuery(category="desk"), limit=5)
    assert outcome.results == () and outcome.note is not None and "ConnectError" in outcome.note


def test_search_backend_selection() -> None:
    both = Settings(environment="test", openai_api_key="sk", serpapi_api_key="sp")
    assert both.search_backend == "serpapi"
    assert isinstance(build_product_sourcing(both)._search_provider, SerpApiShoppingProvider)  # noqa: SLF001

    openai_only = Settings(environment="test", openai_api_key="sk", serpapi_api_key=None)
    assert openai_only.search_backend == "openai"
    assert isinstance(build_product_sourcing(openai_only)._search_provider, OpenAIWebSearchProvider)  # noqa: SLF001

    none = Settings(environment="test", openai_api_key=None, serpapi_api_key=None)
    assert none.search_backend == "fixture"
    assert isinstance(build_product_sourcing(none)._search_provider, FixtureSearchProvider)  # noqa: SLF001

    forced = Settings(
        environment="test", openai_api_key="sk", serpapi_api_key="sp", product_search="fixture"
    )
    assert forced.search_backend == "fixture"


def test_listings_fixture_is_valid_json_shape() -> None:
    assert json.loads(json.dumps(LISTINGS))["shopping_results"][0]["extracted_price"] == 27.88
