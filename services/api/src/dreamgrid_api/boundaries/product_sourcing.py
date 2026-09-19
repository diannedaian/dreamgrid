"""Provider-neutral boundary for Linda's product-sourcing pipeline.

Sourcing turns a product URL or a search request into a ``ProductDraft``: a
partial, best-effort description that the web client completes before it
becomes a contract-valid ``Product``. No field here is guaranteed; ``missing``
lists what the caller still needs. No provider SDK types belong here.
"""

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Literal, Protocol

ExtractionMethod = Literal["structured-data", "text-pattern", "llm", "fixture", "manual"]

ProductCategory = Literal["bed", "desk", "chair", "shelf", "lamp", "decor"]

PRODUCT_CATEGORIES: tuple[ProductCategory, ...] = ("bed", "desk", "chair", "shelf", "lamp", "decor")

Region = Literal["us", "ca", "uk", "eu", "au"]

REGIONS: tuple[Region, ...] = ("us", "ca", "uk", "eu", "au")

DRAFT_FIELDS: tuple[str, ...] = ("title", "priceUsd", "imageUrl", "dimensionsM", "category")


@dataclass(frozen=True)
class ProductDraft:
    """Best-effort product data. Dimensions are width, height, depth in meters."""

    source_url: str
    title: str | None = None
    price_usd: Decimal | None = None
    merchant: str | None = None
    image_url: str | None = None
    dimensions_m: tuple[float, float, float] | None = None
    category: ProductCategory | None = None
    style_tags: tuple[str, ...] = ()
    color_tags: tuple[str, ...] = ()
    confidence: float = 0.0
    extraction_method: ExtractionMethod = "manual"
    missing: tuple[str, ...] = field(default_factory=lambda: DRAFT_FIELDS)
    note: str | None = None


@dataclass(frozen=True)
class ProductQuery:
    """What the user is looking for; ``target_dimensions_m`` is width, height, depth."""

    category: ProductCategory
    keywords: str = ""
    target_dimensions_m: tuple[float, float, float] | None = None
    max_price_usd: Decimal | None = None
    style_tags: tuple[str, ...] = ()
    region: Region = "us"


@dataclass(frozen=True)
class SearchOutcome:
    """Search results plus where they came from, for the UI disclosure."""

    results: tuple[ProductDraft, ...]
    source: Literal["live", "fixture"]
    note: str | None = None
    """Which backend answered, for the UI disclosure."""
    provider: Literal["fixture", "openai", "serpapi"] = "fixture"


class ProductSourcingGateway(Protocol):
    """Port implemented by the scraping/search adapter or a fixture stand-in."""

    async def import_from_url(self, url: str) -> ProductDraft:
        """Read one product page. Must not raise for an unreadable page."""
        ...

    async def search(self, query: ProductQuery, *, limit: int = 8) -> SearchOutcome:
        """Find candidate products. Must not raise when the provider is unavailable."""
        ...
