"""Product search through SerpAPI's Google Shopping engine.

One HTTP call returns real listings with real prices and merchant links in
about a second, which beats an LLM acting as a search engine on both speed and
accuracy. Listings do not carry dimensions; the import path fills those when
the user picks a result.
"""

from decimal import Decimal
from typing import Any
from urllib.parse import urlsplit

import httpx

from dreamgrid_api.boundaries.product_sourcing import (
    ProductDraft,
    ProductQuery,
    Region,
    SearchOutcome,
)

SERPAPI_URL = "https://serpapi.com/search.json"
TIMEOUT_SECONDS = 15.0

# Google's `gl` country code per region; the EU is not a country, so use Germany.
_REGION_GL: dict[Region, tuple[str, str]] = {
    "us": ("us", "en"),
    "ca": ("ca", "en"),
    "uk": ("uk", "en"),
    "eu": ("de", "en"),
    "au": ("au", "en"),
}


def build_params(
    query: ProductQuery, api_key: str, limit: int, *, price_in_query: bool = True
) -> dict[str, str]:
    """
    The Google Shopping engine ignores the ``tbs`` price filter, so the only lever is the
    query text. "under $X" narrows common queries well ("desk under $150") but makes Google
    return nothing at all for niche ones ("panda lamp under $50"); ``search`` retries without
    it when the first call comes back empty.
    """
    gl, hl = _REGION_GL[query.region]
    terms = " ".join(part for part in (query.keywords.strip(), query.category) if part)
    if price_in_query and query.max_price_usd is not None and query.region == "us":
        terms = f"{terms} under ${int(query.max_price_usd)}"
    return {
        "engine": "google_shopping",
        "q": terms,
        "gl": gl,
        "hl": hl,
        "num": str(max(limit * 4, 20)),
        "api_key": api_key,
    }


def listing_key(item: dict[str, Any], draft: ProductDraft) -> str:
    """One entry per catalog item even when several sellers list it."""

    for key in ("product_id", "catalog_id"):
        value = item.get(key)
        if isinstance(value, str | int) and str(value):
            return f"id:{value}"
    url = draft.source_url
    for marker in ("catalogid:", "productid:"):
        if marker in url:
            return "id:" + url.split(marker, 1)[1].split(",")[0].split("&")[0]
    return f"title:{(draft.title or '').lower()}"


def order_within_budget_first(
    drafts: list[ProductDraft], max_price_usd: Decimal | None
) -> list[ProductDraft]:
    """Google's relevance order, but anything at or under the limit comes before anything over."""

    if max_price_usd is None:
        return drafts
    within = [d for d in drafts if d.price_usd is not None and d.price_usd <= max_price_usd]
    unknown = [d for d in drafts if d.price_usd is None]
    over = [d for d in drafts if d.price_usd is not None and d.price_usd > max_price_usd]
    return within + unknown + over


def _merchant_url(item: dict[str, Any]) -> str | None:
    """Prefer the merchant's own page; fall back to the Google Shopping product page."""

    valid = [
        url
        for url in (item.get("link"), item.get("product_link"))
        if isinstance(url, str) and urlsplit(url).scheme in {"http", "https"}
    ]
    for url in valid:
        if "google." not in (urlsplit(url).hostname or "").lower():
            return url
    return valid[0] if valid else None


def draft_from_listing(item: Any, query: ProductQuery) -> ProductDraft | None:
    if not isinstance(item, dict):
        return None
    url = _merchant_url(item)
    title = item.get("title") if isinstance(item.get("title"), str) else None
    if url is None or not title:
        return None

    price: Decimal | None = None
    raw_price = item.get("extracted_price")
    if isinstance(raw_price, int | float) and not isinstance(raw_price, bool) and raw_price > 0:
        price = Decimal(str(round(float(raw_price), 2)))
    price_usd = price if query.region == "us" else None

    merchant = item.get("source") if isinstance(item.get("source"), str) else None
    image = item.get("thumbnail") if isinstance(item.get("thumbnail"), str) else None
    missing = tuple(
        name
        for name, value in (("priceUsd", price_usd), ("imageUrl", image), ("dimensionsM", None))
        if value is None
    )
    note = "Google Shopping listing via SerpAPI. Read the link to fetch dimensions."
    if query.region != "us" and price is not None:
        note = f"Listed at {item.get('price', price)} in local currency (not converted). " + note
    return ProductDraft(
        source_url=url,
        title=title.strip(),
        price_usd=price_usd,
        merchant=merchant or (urlsplit(url).hostname or "").removeprefix("www.") or None,
        image_url=image,
        dimensions_m=None,
        category=query.category,
        confidence=0.8 if price_usd is not None else 0.5,
        extraction_method="structured-data",
        missing=missing,
        note=note,
    )


class SerpApiShoppingProvider:
    def __init__(self, api_key: str, client: httpx.AsyncClient | None = None) -> None:
        self._api_key = api_key
        self._client = client

    async def search(self, query: ProductQuery, *, limit: int) -> SearchOutcome:
        client = self._client or httpx.AsyncClient(timeout=TIMEOUT_SECONDS)
        try:
            listings = await self._listings(client, query, limit, price_in_query=True)
            if not listings and query.max_price_usd is not None and query.region == "us":
                # "panda lamp under $50" → nothing; "panda lamp" → 40 listings. Ask again and
                # let the budget ordering below (and the UI's over-budget marking) do the rest.
                listings = await self._listings(client, query, limit, price_in_query=False)
        except httpx.HTTPError as error:
            return SearchOutcome(
                results=(),
                source="live",
                provider="serpapi",
                note=f"Search unavailable ({error.__class__.__name__}).",
            )
        except _HttpStatus as error:
            return SearchOutcome(
                results=(),
                source="live",
                provider="serpapi",
                note=f"Search unavailable (SerpAPI answered HTTP {error.status}).",
            )
        finally:
            if self._client is None:
                await client.aclose()

        seen: set[str] = set()
        candidates: list[ProductDraft] = []
        for item in listings:
            draft = draft_from_listing(item, query)
            if draft is None:
                continue
            key = listing_key(item, draft)
            if key in seen or draft.source_url in seen:
                continue
            seen.update((key, draft.source_url))
            candidates.append(draft)
        ordered = order_within_budget_first(
            candidates, query.max_price_usd if query.region == "us" else None
        )
        results = tuple(ordered[:limit])
        note = None if results else "No Google Shopping listings matched. Try fewer constraints."
        return SearchOutcome(results=results, source="live", provider="serpapi", note=note)

    async def _listings(
        self, client: httpx.AsyncClient, query: ProductQuery, limit: int, *, price_in_query: bool
    ) -> list[dict[str, Any]]:
        response = await client.get(
            SERPAPI_URL,
            params=build_params(query, self._api_key, limit, price_in_query=price_in_query),
        )
        if response.status_code >= 400:
            raise _HttpStatus(response.status_code)
        payload = response.json()
        listings = payload.get("shopping_results", []) if isinstance(payload, dict) else []
        return [item for item in listings if isinstance(item, dict)]


class _HttpStatus(Exception):
    def __init__(self, status: int) -> None:
        super().__init__(f"HTTP {status}")
        self.status = status
