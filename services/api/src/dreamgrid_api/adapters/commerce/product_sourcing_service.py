"""Composes fetcher, parser, LLM rung, and search provider behind the gateway.

Results are cached in memory per process so a rehearsed demo does not re-fetch
or re-spend on the same URL or query.
"""

from collections import OrderedDict
from dataclasses import replace
from pathlib import Path
from typing import Generic, TypeVar
from urllib.parse import urlsplit

from dreamgrid_api.adapters.commerce.html_product_parser import parse_product_page, visible_text
from dreamgrid_api.adapters.commerce.llm_product_extractor import (
    LlmProductExtractor,
    NullProductExtractor,
    ProductExtractor,
)
from dreamgrid_api.adapters.commerce.openai_client import OpenAIResponsesModel
from dreamgrid_api.adapters.commerce.page_fetcher import (
    HttpxPageFetcher,
    PageFetcher,
    PageFetchError,
    validate_public_http_url,
)
from dreamgrid_api.adapters.commerce.search_provider import (
    FixtureSearchProvider,
    OpenAIWebSearchProvider,
    SearchProvider,
)
from dreamgrid_api.adapters.commerce.serpapi_search_provider import SerpApiShoppingProvider
from dreamgrid_api.adapters.commerce.url_lookup import NullUrlLookup, OpenAIUrlLookup, UrlLookup
from dreamgrid_api.boundaries.product_sourcing import ProductDraft, ProductQuery, SearchOutcome
from dreamgrid_api.config import Settings

CACHE_LIMIT = 256

K = TypeVar("K")
V = TypeVar("V")


class _LruCache(Generic[K, V]):
    def __init__(self, limit: int = CACHE_LIMIT) -> None:
        self._limit = limit
        self._items: OrderedDict[K, V] = OrderedDict()

    def get(self, key: K) -> V | None:
        if key not in self._items:
            return None
        self._items.move_to_end(key)
        return self._items[key]

    def put(self, key: K, value: V) -> None:
        self._items[key] = value
        self._items.move_to_end(key)
        while len(self._items) > self._limit:
            self._items.popitem(last=False)


class ProductSourcingService:
    """Default ``ProductSourcingGateway`` implementation."""

    def __init__(
        self,
        fetcher: PageFetcher,
        extractor: ProductExtractor,
        search_provider: SearchProvider,
        url_lookup: UrlLookup | None = None,
    ) -> None:
        self._fetcher = fetcher
        self._extractor = extractor
        self._search_provider = search_provider
        self._url_lookup = url_lookup or NullUrlLookup()
        self._import_cache: _LruCache[str, ProductDraft] = _LruCache()
        self._search_cache: _LruCache[tuple[object, ...], SearchOutcome] = _LruCache()

    async def import_from_url(self, url: str) -> ProductDraft:
        key = url.strip()
        cached = self._import_cache.get(key)
        if cached is not None:
            return cached

        try:
            validate_public_http_url(key)
            page = await self._fetcher.fetch(key)
        except PageFetchError as error:
            return await self._blocked(key, f"{error} Enter the details by hand.")

        draft = parse_product_page(page.html, page.final_url or key)
        if draft.extraction_method == "manual":
            # A bot wall or JavaScript shell: nothing to extract from, try a lookup.
            return await self._blocked(key, draft.note or "Enter the details by hand.")
        if draft.missing:
            draft = await self._extractor.extract(draft, visible_text(page.html))
        self._import_cache.put(key, draft)
        return draft

    async def _blocked(self, url: str, note: str) -> ProductDraft:
        """The page could not be read directly; try a web-search lookup if one is configured."""

        found = await self._url_lookup.lookup(url)
        if found is None:
            return manual_draft(url, note)
        self._import_cache.put(url, found)
        return found

    async def search(self, query: ProductQuery, *, limit: int = 8) -> SearchOutcome:
        key = (
            query.category,
            query.keywords.strip().lower(),
            query.target_dimensions_m,
            query.max_price_usd,
            query.style_tags,
            query.region,
            limit,
        )
        cached = self._search_cache.get(key)
        if cached is not None:
            return cached
        outcome = await self._search_provider.search(query, limit=limit)
        if outcome.results:
            self._search_cache.put(key, outcome)
        return outcome


def manual_draft(url: str, note: str) -> ProductDraft:
    host = (urlsplit(url).hostname or "").removeprefix("www.")
    return replace(ProductDraft(source_url=url), merchant=host or None, note=note)


def default_fixture_path() -> Path:
    """``<repo>/fixtures/search-results.json`` relative to this package."""

    # commerce/ adapters/ dreamgrid_api/ src/ api/ services/ <repo>
    return Path(__file__).resolve().parents[6] / "fixtures" / "search-results.json"


def build_product_sourcing(settings: Settings) -> ProductSourcingService:
    """Pick live or placeholder components from settings. Never needs a key to start."""

    fixture_path = (
        Path(settings.fixtures_dir) / "search-results.json"
        if settings.fixtures_dir
        else default_fixture_path()
    )
    fixture_search = FixtureSearchProvider(fixture_path)

    extractor: ProductExtractor = NullProductExtractor()
    search: SearchProvider = fixture_search
    lookup: UrlLookup = NullUrlLookup()
    model: OpenAIResponsesModel | None = None
    if settings.sourcing_is_live and settings.openai_api_key:
        model = OpenAIResponsesModel(
            settings.openai_api_key.get_secret_value(), settings.openai_model
        )
        extractor = LlmProductExtractor(model)
        lookup = OpenAIUrlLookup(model, tool_type=settings.openai_web_search_tool)

    backend = settings.search_backend
    if backend == "serpapi" and settings.serpapi_api_key:
        search = SerpApiShoppingProvider(settings.serpapi_api_key.get_secret_value())
    elif backend == "openai" and model is not None:
        search = OpenAIWebSearchProvider(model, tool_type=settings.openai_web_search_tool)

    return ProductSourcingService(HttpxPageFetcher(), extractor, search, lookup)
