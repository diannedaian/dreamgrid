"""Last rung of the import ladder: ask a model to read the page text.

Used only for fields the structured and pattern rungs could not fill. Output
is schema-constrained JSON, so nothing model-generated is executed or trusted
beyond being shown to the user as an AI-extracted draft to confirm.
"""

from dataclasses import replace
from typing import Any, Protocol

from dreamgrid_api.adapters.commerce.openai_client import (
    JsonSchemaFormat,
    OpenAIError,
    TextModel,
    parse_json_object,
)
from dreamgrid_api.boundaries.product_sourcing import (
    PRODUCT_CATEGORIES,
    ProductDraft,
)

EXTRACTION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "title",
        "priceUsd",
        "widthCm",
        "heightCm",
        "depthCm",
        "category",
        "styleTags",
        "colorTags",
    ],
    "properties": {
        "title": {"type": ["string", "null"]},
        "priceUsd": {"type": ["number", "null"]},
        "widthCm": {"type": ["number", "null"]},
        "heightCm": {"type": ["number", "null"]},
        "depthCm": {"type": ["number", "null"]},
        "category": {"type": ["string", "null"], "enum": [*PRODUCT_CATEGORIES, None]},
        "styleTags": {"type": "array", "items": {"type": "string"}},
        "colorTags": {"type": "array", "items": {"type": "string"}},
    },
}

INSTRUCTIONS = (
    "You extract furniture product facts from the visible text of one store page. "
    "Report only what the text states; use null when a value is not present. "
    "Convert every dimension to centimeters. Width is left-to-right, depth is front-to-back, "
    "height is floor-to-top. priceUsd is the current selling price in US dollars, "
    "not a strike-through or savings amount. category must be one of: "
    + ", ".join(PRODUCT_CATEGORIES)
    + ". styleTags and colorTags are short lowercase words."
)


class ProductExtractor(Protocol):
    async def extract(self, draft: ProductDraft, page_text: str) -> ProductDraft: ...


class NullProductExtractor:
    """Placeholder when no model key is configured: the draft passes through unchanged."""

    async def extract(self, draft: ProductDraft, page_text: str) -> ProductDraft:
        return draft


class LlmProductExtractor:
    def __init__(self, model: TextModel) -> None:
        self._model = model

    async def extract(self, draft: ProductDraft, page_text: str) -> ProductDraft:
        if not draft.missing or not page_text.strip():
            return draft
        try:
            raw = await self._model.complete(
                instructions=INSTRUCTIONS,
                user_input=(
                    f"Page URL: {draft.source_url}\n"
                    f"Known title: {draft.title or 'unknown'}\n"
                    f"Missing: {', '.join(draft.missing)}\n\n"
                    f"Page text:\n{page_text}"
                ),
                output=JsonSchemaFormat(name="product_facts", schema=EXTRACTION_SCHEMA),
            )
            facts = parse_json_object(raw.text)
        except OpenAIError as error:
            return replace(draft, note=f"AI extraction unavailable: {error}")
        return merge_llm_facts(draft, facts)


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
    seen: list[str] = []
    for item in value:
        if isinstance(item, str) and item.strip():
            tag = item.strip().lower()
            if tag not in seen:
                seen.append(tag)
    return tuple(seen)


def merge_llm_facts(draft: ProductDraft, facts: dict[str, Any]) -> ProductDraft:
    """Fill only the fields the draft is missing; never overwrite structured data."""

    updates: dict[str, Any] = {}
    filled_by_llm = False

    if "title" in draft.missing and isinstance(facts.get("title"), str) and facts["title"].strip():
        updates["title"] = facts["title"].strip()
        filled_by_llm = True

    # Prices are never taken from the model; a reported figure becomes a note.
    price_hint = _number(facts.get("priceUsd")) if "priceUsd" in draft.missing else None

    if "dimensionsM" in draft.missing:
        width, height, depth = (
            _number(facts.get("widthCm")),
            _number(facts.get("heightCm")),
            _number(facts.get("depthCm")),
        )
        if width and height and depth:
            updates["dimensions_m"] = (
                round(width / 100, 3),
                round(height / 100, 3),
                round(depth / 100, 3),
            )
            filled_by_llm = True

    if "category" in draft.missing:
        category = facts.get("category")
        if isinstance(category, str) and category in PRODUCT_CATEGORIES:
            updates["category"] = category
            filled_by_llm = True

    if not draft.style_tags:
        updates["style_tags"] = _tags(facts.get("styleTags"))
    if not draft.color_tags:
        updates["color_tags"] = _tags(facts.get("colorTags"))

    if price_hint is not None:
        hint = f"AI-reported price about ${price_hint:.2f} (unverified); enter the real price."
        updates["note"] = f"{draft.note} {hint}" if draft.note else hint

    if not filled_by_llm:
        return replace(draft, **updates)

    merged = replace(draft, **updates)
    still_missing = tuple(
        name
        for name, value in (
            ("title", merged.title),
            ("priceUsd", merged.price_usd),
            ("imageUrl", merged.image_url),
            ("dimensionsM", merged.dimensions_m),
            ("category", merged.category),
        )
        if value is None
    )
    note = "Some fields were extracted by AI; please check them."
    if price_hint is not None:
        note += f" AI-reported price about ${price_hint:.2f} (unverified); enter the real price."
    return replace(
        merged,
        missing=still_missing,
        extraction_method="llm",
        confidence=min(0.7, round((5 - len(still_missing)) / 5, 2)),
        note=note,
    )
