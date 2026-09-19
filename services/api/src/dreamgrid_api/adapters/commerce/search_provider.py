"""Find candidate products for a category, size, and price.

Two providers share one protocol: the OpenAI web-search tool (live) and a
fixture file (placeholder for demos and for machines without a key).
"""

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import urlsplit

from dreamgrid_api.adapters.commerce.openai_client import (
    JsonSchemaFormat,
    OpenAIError,
    TextModel,
    parse_json_object,
)
from dreamgrid_api.adapters.commerce.page_fetcher import probe_status
from dreamgrid_api.boundaries.product_sourcing import (
    PRODUCT_CATEGORIES,
    ProductCategory,
    ProductDraft,
    ProductQuery,
    Region,
    SearchOutcome,
)


logger = logging.getLogger(__name__)


class SearchProvider(Protocol):
    async def search(self, query: ProductQuery, *, limit: int) -> SearchOutcome: ...


SEARCH_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["results"],
    "properties": {
        "results": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "title",
                    "sourceUrl",
                    "merchant",
                    "priceUsd",
                    "imageUrl",
                    "widthCm",
                    "heightCm",
                    "depthCm",
                    "styleTags",
                    "colorTags",
                ],
                "properties": {
                    "title": {"type": "string"},
                    "sourceUrl": {"type": "string"},
                    "merchant": {"type": ["string", "null"]},
                    "priceUsd": {"type": ["number", "null"]},
                    "imageUrl": {"type": ["string", "null"]},
                    "widthCm": {"type": ["number", "null"]},
                    "heightCm": {"type": ["number", "null"]},
                    "depthCm": {"type": ["number", "null"]},
                    "styleTags": {"type": "array", "items": {"type": "string"}},
                    "colorTags": {"type": "array", "items": {"type": "string"}},
                },
            },
        }
    },
}


@dataclass(frozen=True)
class RegionProfile:
    name: str
    currency: str
    retailers: str


REGION_PROFILES: dict[Region, RegionProfile] = {
    "us": RegionProfile(
        "the United States",
        "US dollars (USD)",
        "amazon.com, wayfair.com, target.com, walmart.com, ikea.com/us, overstock.com, "
        "homedepot.com",
    ),
    "ca": RegionProfile(
        "Canada",
        "Canadian dollars (CAD)",
        "amazon.ca, wayfair.ca, ikea.com/ca, canadiantire.ca, structube.com, article.com",
    ),
    "uk": RegionProfile(
        "the United Kingdom",
        "pounds sterling (GBP)",
        "amazon.co.uk, argos.co.uk, ikea.com/gb, wayfair.co.uk, dunelm.com, johnlewis.com",
    ),
    "eu": RegionProfile(
        "the European Union",
        "euros (EUR)",
        "amazon.de, amazon.fr, ikea.com (EU country sites), wayfair.de, maisonsdumonde.com, "
        "home24.de",
    ),
    "au": RegionProfile(
        "Australia",
        "Australian dollars (AUD)",
        "amazon.com.au, ikea.com/au, kmart.com.au, bigw.com.au, templeandwebster.com.au, "
        "fantasticfurniture.com.au",
    ),
}


def search_instructions(region: Region) -> str:
    profile = REGION_PROFILES[region]
    conversion = (
        ""
        if region == "us"
        else (
            f" Report priceUsd as the store price converted from {profile.currency} to US "
            "dollars at the current exchange rate, rounded to whole dollars."
        )
    )
    return (
        f"You are a furniture shopping assistant for a shopper in {profile.name}. Use web "
        f"search to find products currently sold by retailers that ship within {profile.name} "
        f"and list prices in {profile.currency} (for example {profile.retailers}). Exclude "
        "stores in other countries. Return real product page URLs (not search or category "
        "pages), the current price, and the product's own dimensions in centimeters when the "
        "page states them; use null for anything you cannot verify. Prefer items at or under "
        "the price limit and close to the target size, but include the closest options if "
        "nothing fits exactly. Spread results across at least three different merchants with "
        "no more than two products from any one merchant. Only return a sourceUrl that "
        "appeared in your web search results and that you opened; never construct, guess, or "
        f"edit a URL.{conversion}"
    )


# Kept for callers that only need the default prompt.
SEARCH_INSTRUCTIONS = search_instructions("us")

STRUCTURE_INSTRUCTIONS = (
    "You convert shopping research notes into JSON. Every result's sourceUrl MUST be copied "
    "exactly from the ALLOWED URLS list; never invent, shorten, or edit a URL. Use the URL of "
    "the product's own page. If a product's only URL in the list is a search or category page, "
    "omit that product. One entry per distinct product. Prices in US dollars; dimensions in "
    "centimeters (width, height, depth); null for anything the notes do not state."
)

# Paths that are store search/category listings rather than one product's page.
_LISTING_HINTS = (
    "/c/",
    "/b/",
    "/s/",
    "/s?",
    "/search",
    "/browse",
    "/category",
    "/categories",
    "/kp/",
    "/sb/",
    "/shop/",
    "/collections/",
    "/results",
    "/sch/",
    "?q=",
    "?k=",
    "?query=",
)


def is_listing_page(url: str) -> bool:
    lowered = url.lower()
    path = urlsplit(lowered).path
    if path in ("", "/"):
        return True
    return any(hint in lowered for hint in _LISTING_HINTS)


def _describe_query(query: ProductQuery, limit: int) -> str:
    parts = [f"Find up to {limit} {query.category} products"]
    if query.keywords:
        parts.append(f"matching: {query.keywords}")
    if query.target_dimensions_m:
        width, height, depth = query.target_dimensions_m
        parts.append(
            f"about {width * 100:.0f} cm wide, {height * 100:.0f} cm tall, "
            f"{depth * 100:.0f} cm deep"
        )
    if query.max_price_usd is not None:
        parts.append(f"priced at or under ${query.max_price_usd}")
    if query.style_tags:
        parts.append("in a " + ", ".join(query.style_tags) + " style")
    return "; ".join(parts) + "."


MAX_PER_MERCHANT = 2
GONE_STATUSES = {404, 410}

UrlProbe = Callable[[str], Awaitable[int | None]]


def normalize_url(url: str) -> str:
    """host + path, lowercased, without query, fragment, or trailing slash."""

    parts = urlsplit(url.strip())
    host = (parts.hostname or "").removeprefix("www.")
    return f"{host}{parts.path.rstrip('/').lower()}"


def _merchant_key(draft: ProductDraft) -> str:
    return (
        (urlsplit(draft.source_url).hostname or draft.merchant or "").removeprefix("www.").lower()
    )


def diversify(drafts: list[ProductDraft], limit: int) -> list[ProductDraft]:
    """Drop duplicate URLs and cap results per merchant so one store cannot fill the list."""

    seen_urls: set[str] = set()
    per_merchant: dict[str, int] = {}
    kept: list[ProductDraft] = []
    for draft in drafts:
        key = normalize_url(draft.source_url)
        merchant = _merchant_key(draft)
        if key in seen_urls or per_merchant.get(merchant, 0) >= MAX_PER_MERCHANT:
            continue
        seen_urls.add(key)
        per_merchant[merchant] = per_merchant.get(merchant, 0) + 1
        kept.append(draft)
        if len(kept) >= limit:
            break
    return kept


def keep_cited(drafts: list[ProductDraft], cited_urls: tuple[str, ...]) -> list[ProductDraft]:
    """Keep only hits whose URL the search tool actually cited.

    With no citations at all (a model that did not use the tool) nothing can be
    verified, so everything is kept and the URL probe is the only safeguard.
    """

    if not cited_urls:
        return drafts
    cited = {normalize_url(url) for url in cited_urls}
    return [draft for draft in drafts if normalize_url(draft.source_url) in cited]


async def drop_gone(drafts: list[ProductDraft], probe: UrlProbe) -> tuple[list[ProductDraft], int]:
    """Probe every URL concurrently; drop the ones that answer 404/410."""

    statuses = await asyncio.gather(*(probe(draft.source_url) for draft in drafts))
    kept = [d for d, status in zip(drafts, statuses, strict=True) if status not in GONE_STATUSES]
    return kept, len(drafts) - len(kept)


class OpenAIWebSearchProvider:
    """Live provider using the Responses API web-search tool."""

    def __init__(
        self,
        model: TextModel,
        tool_type: str = "web_search",
        probe: UrlProbe = probe_status,
    ) -> None:
        self._model = model
        self._tool_type = tool_type
        self._probe = probe

    async def search(self, query: ProductQuery, *, limit: int) -> SearchOutcome:
        """Two calls: a text-mode web search (real citations), then structuring without tools.

        Asking for strict JSON and web search in one call made the model invent URLs
        and return no citations, so the URLs come only from the first call's
        ``url_citation`` annotations.
        """

        try:
            research = await self._model.complete(
                instructions=search_instructions(query.region),
                user_input=_describe_query(query, limit + 4),
                tools=({"type": self._tool_type},),
            )
            allowed = [url for url in research.cited_urls if not is_listing_page(url)]
            logger.info(
                "product search: %d cited urls, %d product pages, %d chars of notes",
                len(research.cited_urls),
                len(allowed),
                len(research.text),
            )
            if research.cited_urls and not allowed:
                return SearchOutcome(
                    results=(),
                    source="live",
                    note="The search only found store category pages, not product pages. "
                    "Try different keywords.",
                )
            structured = await self._model.complete(
                instructions=STRUCTURE_INSTRUCTIONS,
                user_input=(
                    "ALLOWED URLS:\n"
                    + "\n".join(allowed or research.cited_urls)
                    + "\n\nNOTES:\n"
                    + research.text
                ),
                output=JsonSchemaFormat(name="product_search", schema=SEARCH_SCHEMA),
            )
            payload = parse_json_object(structured.text)
        except OpenAIError as error:
            return SearchOutcome(results=(), source="live", note=f"Search unavailable: {error}")
        candidates = [
            draft
            for item in payload.get("results", [])
            if (draft := draft_from_search_hit(item, query.category)) is not None
        ]
        logger.info("product search: %d structured hits", len(candidates))
        candidates = keep_cited(candidates, research.cited_urls)
        logger.info("product search: %d hits after citation filter", len(candidates))
        candidates = [draft for draft in candidates if not is_listing_page(draft.source_url)]
        candidates = diversify(candidates, limit + 4)
        candidates, dropped = await drop_gone(candidates, self._probe)
        results = tuple(candidates[:limit])
        note = None
        if dropped:
            note = f"{dropped} result(s) pointed at pages that no longer exist and were removed."
        if query.region != "us":
            conversion = (
                "Prices were converted to US dollars by the AI; "
                "check the store for the exact amount."
            )
            note = f"{note} {conversion}" if note else conversion
        return SearchOutcome(results=results, source="live", note=note)


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def _tags(value: Any) -> tuple[str, ...]:
    if not isinstance(value, list):
        return ()
    return tuple(
        dict.fromkeys(t.strip().lower() for t in value if isinstance(t, str) and t.strip())
    )


def draft_from_search_hit(item: Any, category: ProductCategory) -> ProductDraft | None:
    """Turn one model-reported hit into a draft; skip hits without a usable URL."""

    if not isinstance(item, dict):
        return None
    url = item.get("sourceUrl")
    if not isinstance(url, str) or urlsplit(url).scheme not in {"http", "https"}:
        return None
    title = item.get("title") if isinstance(item.get("title"), str) else None
    price = _number(item.get("priceUsd"))
    width, height, depth = (
        _number(item.get("widthCm")),
        _number(item.get("heightCm")),
        _number(item.get("depthCm")),
    )
    dimensions = (
        (round(width / 100, 3), round(height / 100, 3), round(depth / 100, 3))
        if width and height and depth
        else None
    )
    image = item.get("imageUrl") if isinstance(item.get("imageUrl"), str) else None
    merchant = item.get("merchant") if isinstance(item.get("merchant"), str) else None
    missing = tuple(
        name
        for name, value in (
            ("title", title),
            ("priceUsd", price),
            ("imageUrl", image),
            ("dimensionsM", dimensions),
        )
        if value is None
    )
    return ProductDraft(
        source_url=url,
        title=title,
        price_usd=Decimal(str(round(price, 2))) if price is not None else None,
        merchant=merchant or (urlsplit(url).hostname or "").removeprefix("www.") or None,
        image_url=image,
        dimensions_m=dimensions,
        category=category,
        style_tags=_tags(item.get("styleTags")),
        color_tags=_tags(item.get("colorTags")),
        confidence=min(0.7, round((4 - len(missing)) / 4, 2)),
        extraction_method="llm",
        missing=missing,
        note="Found by AI web search; confirm price and size on the store page.",
    )


class FixtureSearchProvider:
    """Placeholder provider reading ``fixtures/search-results.json`` from the repo."""

    def __init__(self, fixture_path: Path) -> None:
        self._fixture_path = fixture_path
        self._cache: list[dict[str, Any]] | None = None

    def _load(self) -> list[dict[str, Any]]:
        if self._cache is None:
            try:
                data = json.loads(self._fixture_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                data = []
            self._cache = [item for item in data if isinstance(item, dict)]
        return self._cache

    async def search(self, query: ProductQuery, *, limit: int) -> SearchOutcome:
        results: list[ProductDraft] = []
        for item in self._load():
            category = item.get("category")
            if category != query.category or category not in PRODUCT_CATEGORIES:
                continue
            dims = item.get("dimensionsM")
            results.append(
                ProductDraft(
                    source_url=str(item.get("sourceUrl", "")),
                    title=item.get("title"),
                    price_usd=Decimal(str(item["priceUsd"])) if "priceUsd" in item else None,
                    merchant=item.get("merchant"),
                    image_url=item.get("imageUrl"),
                    dimensions_m=tuple(dims) if isinstance(dims, list) and len(dims) == 3 else None,
                    category=category,
                    style_tags=_tags(item.get("styleTags")),
                    color_tags=_tags(item.get("colorTags")),
                    confidence=1.0,
                    extraction_method="fixture",
                    missing=(),
                    note="Demo fixture result; not a live listing.",
                )
            )
        note = None if results else f"No fixture results for {query.category}."
        return SearchOutcome(results=tuple(results[:limit]), source="fixture", note=note)
