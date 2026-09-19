"""Look a product page up through web search when the store blocks direct reads.

Amazon, IKEA, Wayfair, and Target answer server-side fetches with bot walls or
JavaScript shells. Search indexes usually still hold the listing's title, price,
and specs, so the model is asked to find them for the exact URL. The result is
labeled as AI-found and the user confirms it.
"""

from decimal import Decimal
from typing import Any, Protocol
from urllib.parse import urlsplit

from dreamgrid_api.adapters.commerce.openai_client import (
    JsonSchemaFormat,
    OpenAIError,
    TextModel,
    parse_json_object,
)
from dreamgrid_api.boundaries.product_sourcing import (
    PRODUCT_CATEGORIES,
    ProductCategory,
    ProductDraft,
)

LOOKUP_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "found",
        "title",
        "priceUsd",
        "merchant",
        "imageUrl",
        "widthCm",
        "heightCm",
        "depthCm",
        "category",
        "styleTags",
        "colorTags",
    ],
    "properties": {
        "found": {"type": "boolean"},
        "title": {"type": ["string", "null"]},
        "priceUsd": {"type": ["number", "null"]},
        "merchant": {"type": ["string", "null"]},
        "imageUrl": {"type": ["string", "null"]},
        "widthCm": {"type": ["number", "null"]},
        "heightCm": {"type": ["number", "null"]},
        "depthCm": {"type": ["number", "null"]},
        "category": {"type": ["string", "null"], "enum": [*PRODUCT_CATEGORIES, None]},
        "styleTags": {"type": "array", "items": {"type": "string"}},
        "colorTags": {"type": "array", "items": {"type": "string"}},
    },
}

LOOKUP_INSTRUCTIONS = (
    "You identify one furniture product from its store URL. Use web search to find that "
    "exact listing (match the product id in the URL, e.g. an Amazon ASIN after /dp/). Report "
    "its current selling price in US dollars, the product's own dimensions converted to "
    "centimeters (width left-to-right, depth front-to-back, height floor-to-top), a product "
    "image URL, and the merchant. Use null for anything you cannot verify and set found to "
    "false if you cannot identify the listing. category must be one of: "
    + ", ".join(PRODUCT_CATEGORIES)
    + "."
)


class UrlLookup(Protocol):
    async def lookup(self, url: str) -> ProductDraft | None: ...


class NullUrlLookup:
    """Placeholder when no model key is configured."""

    async def lookup(self, url: str) -> ProductDraft | None:
        return None


class OpenAIUrlLookup:
    def __init__(self, model: TextModel, tool_type: str = "web_search") -> None:
        self._model = model
        self._tool_type = tool_type

    async def lookup(self, url: str) -> ProductDraft | None:
        try:
            raw = await self._model.complete(
                instructions=LOOKUP_INSTRUCTIONS,
                user_input=f"Product URL: {url}",
                output=JsonSchemaFormat(name="product_lookup", schema=LOOKUP_SCHEMA),
                tools=({"type": self._tool_type},),
            )
            facts = parse_json_object(raw)
        except OpenAIError:
            return None
        return draft_from_lookup(url, facts)


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def _text(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _tags(value: Any) -> tuple[str, ...]:
    if not isinstance(value, list):
        return ()
    return tuple(
        dict.fromkeys(t.strip().lower() for t in value if isinstance(t, str) and t.strip())
    )


def draft_from_lookup(url: str, facts: dict[str, Any]) -> ProductDraft | None:
    """Build a draft from the model's answer, or None if it found nothing usable."""

    title = _text(facts.get("title"))
    price = _number(facts.get("priceUsd"))
    if not facts.get("found") or (title is None and price is None):
        return None

    width, height, depth = (
        _number(facts.get("widthCm")),
        _number(facts.get("heightCm")),
        _number(facts.get("depthCm")),
    )
    dimensions = (
        (round(width / 100, 3), round(height / 100, 3), round(depth / 100, 3))
        if width and height and depth
        else None
    )
    image = _text(facts.get("imageUrl"))
    raw_category = facts.get("category")
    category: ProductCategory | None = (
        raw_category
        if isinstance(raw_category, str) and raw_category in PRODUCT_CATEGORIES
        else None
    )
    missing = tuple(
        name
        for name, value in (
            ("title", title),
            ("priceUsd", price),
            ("imageUrl", image),
            ("dimensionsM", dimensions),
            ("category", category),
        )
        if value is None
    )
    host = (urlsplit(url).hostname or "").removeprefix("www.")
    return ProductDraft(
        source_url=url,
        title=title,
        price_usd=Decimal(str(round(price, 2))) if price is not None else None,
        merchant=_text(facts.get("merchant")) or host or None,
        image_url=image,
        dimensions_m=dimensions,
        category=category,
        style_tags=_tags(facts.get("styleTags")),
        color_tags=_tags(facts.get("colorTags")),
        confidence=min(0.6, round((5 - len(missing)) / 5, 2)),
        extraction_method="llm",
        missing=missing,
        note=(
            "The store blocked direct reading, so these details were found by AI web search. "
            "Check them against the store page."
        ),
    )
