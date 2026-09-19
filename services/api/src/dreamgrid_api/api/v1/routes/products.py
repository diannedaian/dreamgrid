"""Product sourcing: read one product page, or search for candidates.

The JSON shapes are camelCase to match ``packages/contracts``. A response is a
``ProductDraft`` (partial), never a ``Product``: the client completes it.
"""

from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from dreamgrid_api.boundaries.product_sourcing import (
    ExtractionMethod,
    ProductCategory,
    ProductDraft,
    ProductQuery,
    ProductSourcingGateway,
    Region,
)
from dreamgrid_api.dependencies import product_sourcing

router = APIRouter(prefix="/products", tags=["products"])


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class ImportProductRequest(CamelModel):
    url: str = Field(min_length=1, max_length=2048)
    """Listing title from a search result; helps a lookup identify the product."""
    title_hint: str | None = Field(default=None, max_length=300)


class ProductDraftResponse(CamelModel):
    source_url: str
    title: str | None = None
    price_usd: float | None = None
    merchant: str | None = None
    image_url: str | None = None
    dimensions_m: tuple[float, float, float] | None = None
    category: ProductCategory | None = None
    style_tags: list[str]
    color_tags: list[str]
    confidence: float
    extraction_method: ExtractionMethod
    missing: list[str]
    note: str | None = None

    @classmethod
    def from_draft(cls, draft: ProductDraft) -> "ProductDraftResponse":
        return cls(
            source_url=draft.source_url,
            title=draft.title,
            price_usd=float(draft.price_usd) if draft.price_usd is not None else None,
            merchant=draft.merchant,
            image_url=draft.image_url,
            dimensions_m=draft.dimensions_m,
            category=draft.category,
            style_tags=list(draft.style_tags),
            color_tags=list(draft.color_tags),
            confidence=draft.confidence,
            extraction_method=draft.extraction_method,
            missing=list(draft.missing),
            note=draft.note,
        )


class SearchProductsRequest(CamelModel):
    category: ProductCategory
    keywords: str = Field(default="", max_length=200)
    target_dimensions_m: tuple[float, float, float] | None = None
    max_price_usd: float | None = Field(default=None, ge=0)
    style_tags: list[str] = Field(default_factory=list, max_length=10)
    region: Region = "us"
    limit: int = Field(default=8, ge=1, le=20)


class SearchProductsResponse(CamelModel):
    source: Literal["live", "fixture"]
    provider: Literal["fixture", "openai", "serpapi"]
    results: list[ProductDraftResponse]
    note: str | None = None


@router.post("/import", response_model=ProductDraftResponse)
async def import_product(
    request: ImportProductRequest,
    gateway: Annotated[ProductSourcingGateway, Depends(product_sourcing)],
) -> ProductDraftResponse:
    """Read a product page. An unreadable page yields a manual draft, not an error."""

    draft = await gateway.import_from_url(request.url, title_hint=request.title_hint)
    return ProductDraftResponse.from_draft(draft)


@router.post("/search", response_model=SearchProductsResponse)
async def search_products(
    request: SearchProductsRequest,
    gateway: Annotated[ProductSourcingGateway, Depends(product_sourcing)],
) -> SearchProductsResponse:
    """Find candidate products; the client ranks them by price and size fit."""

    query = ProductQuery(
        category=request.category,
        keywords=request.keywords.strip(),
        target_dimensions_m=request.target_dimensions_m,
        max_price_usd=(
            Decimal(str(request.max_price_usd)) if request.max_price_usd is not None else None
        ),
        style_tags=tuple(tag.strip().lower() for tag in request.style_tags if tag.strip()),
        region=request.region,
    )
    outcome = await gateway.search(query, limit=request.limit)
    return SearchProductsResponse(
        source=outcome.source,
        provider=outcome.provider,
        results=[ProductDraftResponse.from_draft(draft) for draft in outcome.results],
        note=outcome.note,
    )
