"""Pull product facts out of a page with the standard library only.

Extraction ladder, most reliable first:

1. JSON-LD ``schema.org/Product`` blocks (IKEA, Wayfair, Target, Shopify...).
2. OpenGraph / product meta tags.
3. Dimension and price patterns in the visible text.

Everything is best effort; the result says which rung produced it and what is
still missing so the user can confirm or fill the gaps.
"""

import json
import re
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urljoin, urlsplit

from dreamgrid_api.boundaries.product_sourcing import (
    PRODUCT_CATEGORIES,
    ExtractionMethod,
    ProductCategory,
    ProductDraft,
)

_METERS_PER_UNIT = {"m": 1.0, "cm": 0.01, "mm": 0.001, "in": 0.0254, "ft": 0.3048}

_UNIT_ALIASES = {
    '"': "in",
    "''": "in",
    "in": "in",
    "inch": "in",
    "inches": "in",
    "cm": "cm",
    "centimeter": "cm",
    "centimeters": "cm",
    "mm": "mm",
    "millimeter": "mm",
    "millimeters": "mm",
    "m": "m",
    "meter": "m",
    "meters": "m",
    "metre": "m",
    "metres": "m",
    "ft": "ft",
    "foot": "ft",
    "feet": "ft",
    "'": "ft",
}

_NUMBER = r"(\d+(?:[.,]\d+)?)"
_UNIT = r"\s*(\"|''|'|in(?:ch(?:es)?)?|cm|mm|m(?:et(?:er|re)s?)?|ft|foot|feet)?"
_AXIS = r"\s*(?:\(?\s*(W|D|H|L)\s*\)?)?"
_SEP = r"\s*(?:x|×|X|\*|by)\s*"
_TRIPLE = re.compile(
    rf"(?:(W|D|H|L)\s*:?\s*)?{_NUMBER}{_UNIT}\.?{_AXIS}{_SEP}"
    rf"(?:(W|D|H|L)\s*:?\s*)?{_NUMBER}{_UNIT}\.?{_AXIS}{_SEP}"
    rf"(?:(W|D|H|L)\s*:?\s*)?{_NUMBER}{_UNIT}\.?{_AXIS}",
    re.IGNORECASE,
)
_DIMENSION_HINT = re.compile(r"(dimension|measure|size|overall|product\s+details)", re.IGNORECASE)
_PRICE = re.compile(r"(?:US\s?)?\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\d+(?:\.\d{2})?)")
_WHITESPACE = re.compile(r"\s+")

_CATEGORY_KEYWORDS: tuple[tuple[ProductCategory, tuple[str, ...]], ...] = (
    ("bed", ("bed", "mattress", "daybed", "bunk")),
    ("desk", ("desk", "workstation", "table")),
    ("chair", ("chair", "stool", "seat", "armchair")),
    ("shelf", ("shelf", "shelving", "bookcase", "bookshelf", "cart", "storage", "cabinet")),
    ("lamp", ("lamp", "light", "lighting", "sconce")),
    ("decor", ("rug", "mirror", "art", "plant", "pillow", "curtain", "decor")),
)
_COLOR_WORDS = (
    "white",
    "black",
    "gray",
    "grey",
    "cream",
    "beige",
    "oak",
    "walnut",
    "birch",
    "pine",
    "natural",
    "brown",
    "blue",
    "green",
    "sage",
    "pink",
    "blush",
    "coral",
    "gold",
    "brass",
    "silver",
    "red",
    "yellow",
    "navy",
    "charcoal",
    "ivory",
)
_STYLE_WORDS = (
    "modern",
    "minimal",
    "minimalist",
    "scandinavian",
    "industrial",
    "rustic",
    "cozy",
    "compact",
    "small",
    "mid-century",
    "retro",
    "vintage",
    "boho",
    "playful",
    "soft",
    "slim",
    "farmhouse",
    "contemporary",
    "classic",
)


@dataclass
class _PageFacts:
    title: str | None = None
    json_ld: list[dict[str, Any]] = field(default_factory=list)
    meta: dict[str, str] = field(default_factory=dict)
    text_parts: list[str] = field(default_factory=list)


class _FactCollector(HTMLParser):
    """Single pass over the HTML collecting title, JSON-LD, meta tags, and visible text."""

    _SKIP = {"script", "style", "noscript", "template", "svg", "head"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.facts = _PageFacts()
        self._stack: list[str] = []
        self._in_json_ld = False
        self._in_title = False
        self._buffer: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = {key: value or "" for key, value in attrs}
        if tag == "meta":
            key = attributes.get("property") or attributes.get("name") or attributes.get("itemprop")
            content = attributes.get("content")
            if key and content and key.lower() not in self.facts.meta:
                self.facts.meta[key.lower()] = content.strip()
            return
        if tag == "script" and "ld+json" in attributes.get("type", "").lower():
            self._in_json_ld = True
            self._buffer = []
        if tag == "title":
            self._in_title = True
            self._buffer = []
        self._stack.append(tag)

    def handle_endtag(self, tag: str) -> None:
        if tag == "script" and self._in_json_ld:
            self._in_json_ld = False
            self._ingest_json_ld("".join(self._buffer))
        if tag == "title" and self._in_title:
            self._in_title = False
            title = _WHITESPACE.sub(" ", "".join(self._buffer)).strip()
            if title and not self.facts.title:
                self.facts.title = title
        while self._stack:
            popped = self._stack.pop()
            if popped == tag:
                break

    def handle_data(self, data: str) -> None:
        if self._in_json_ld or self._in_title:
            self._buffer.append(data)
            return
        if any(tag in self._SKIP for tag in self._stack):
            return
        text = _WHITESPACE.sub(" ", data).strip()
        if text:
            self.facts.text_parts.append(text)

    def _ingest_json_ld(self, raw: str) -> None:
        try:
            parsed = json.loads(raw.strip())
        except json.JSONDecodeError:
            return
        self.facts.json_ld.extend(_find_products(parsed))


def _find_products(node: Any) -> list[dict[str, Any]]:
    """Return every object whose @type is (or includes) Product, recursively."""

    found: list[dict[str, Any]] = []
    if isinstance(node, dict):
        types = node.get("@type")
        type_list = types if isinstance(types, list) else [types]
        if any(isinstance(t, str) and t.lower() == "product" for t in type_list):
            found.append(node)
        for value in node.values():
            if isinstance(value, dict | list):
                found.extend(_find_products(value))
    elif isinstance(node, list):
        for item in node:
            found.extend(_find_products(item))
    return found


def _to_decimal(value: Any) -> Decimal | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        text = str(value).replace(",", "").replace("$", "").strip()
        return Decimal(text).quantize(Decimal("0.01")) if text else None
    except (InvalidOperation, ValueError):
        return None


def _first_string(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    if isinstance(value, list):
        for item in value:
            found = _first_string(item)
            if found:
                return found
    if isinstance(value, dict):
        for key in ("url", "contentUrl", "name", "@id"):
            found = _first_string(value.get(key))
            if found:
                return found
    return None


def _json_ld_price(product: dict[str, Any]) -> Decimal | None:
    offers = product.get("offers")
    offer_list = offers if isinstance(offers, list) else [offers]
    for offer in offer_list:
        if not isinstance(offer, dict):
            continue
        currency = str(offer.get("priceCurrency", "USD")).upper()
        if currency not in {"USD", "$"}:
            continue
        for key in ("price", "lowPrice", "highPrice"):
            price = _to_decimal(offer.get(key))
            if price is not None:
                return price
        spec = offer.get("priceSpecification")
        if isinstance(spec, dict):
            price = _to_decimal(spec.get("price"))
            if price is not None:
                return price
    return None


def _quantity_meters(value: Any) -> float | None:
    """schema.org QuantitativeValue -> meters, when the unit is recognizable."""

    if not isinstance(value, dict):
        return None
    amount = value.get("value")
    try:
        number = float(str(amount))
    except (TypeError, ValueError):
        return None
    unit_code = str(value.get("unitCode", value.get("unitText", ""))).upper()
    factor = {
        "CMT": 0.01,
        "CM": 0.01,
        "MMT": 0.001,
        "MM": 0.001,
        "MTR": 1.0,
        "M": 1.0,
        "INH": 0.0254,
        "IN": 0.0254,
        "INCH": 0.0254,
        "FOT": 0.3048,
        "FT": 0.3048,
    }.get(unit_code)
    return round(number * factor, 3) if factor else None


def _json_ld_dimensions(product: dict[str, Any]) -> tuple[float, float, float] | None:
    width = _quantity_meters(product.get("width"))
    height = _quantity_meters(product.get("height"))
    depth = _quantity_meters(product.get("depth"))
    if width and height and depth:
        return (width, height, depth)
    return None


def _to_meters(number: str, unit: str) -> float:
    return round(float(number.replace(",", ".")) * _METERS_PER_UNIT[unit], 3)


def parse_dimensions_text(
    text: str, fallback_unit: str = "in"
) -> tuple[float, float, float] | None:
    """Find a W x D x H pattern and return (width, height, depth) in meters."""

    match = _TRIPLE.search(text)
    if not match:
        return None
    groups = match.groups()
    entries = [
        (groups[0] or groups[3], groups[1], groups[2]),
        (groups[4] or groups[7], groups[5], groups[6]),
        (groups[8] or groups[11], groups[9], groups[10]),
    ]
    unit = next(
        (_UNIT_ALIASES[u.lower()] for _, _, u in entries if u and u.lower() in _UNIT_ALIASES),
        fallback_unit,
    )
    labeled = all(axis for axis, _, _ in entries)
    by_axis: dict[str, str] = {}
    if labeled:
        for axis, number, _ in entries:
            key = "D" if (axis or "").upper() == "L" else (axis or "").upper()
            by_axis[key] = number
    if labeled and {"W", "D", "H"} <= by_axis.keys():
        width, depth, height = by_axis["W"], by_axis["D"], by_axis["H"]
    else:
        width, depth, height = entries[0][1], entries[1][1], entries[2][1]
    return (_to_meters(width, unit), _to_meters(height, unit), _to_meters(depth, unit))


def _dimensions_from_text(text: str) -> tuple[float, float, float] | None:
    """Prefer a pattern that follows a 'dimensions'-like word; fall back to any match."""

    for hint in _DIMENSION_HINT.finditer(text):
        window = text[hint.start() : hint.start() + 160]
        found = parse_dimensions_text(window)
        if found:
            return found
    return parse_dimensions_text(text)


def _price_from_text(text: str) -> Decimal | None:
    match = _PRICE.search(text)
    return _to_decimal(match.group(1)) if match else None


def guess_category(title: str) -> ProductCategory | None:
    lowered = title.lower()
    for category, keywords in _CATEGORY_KEYWORDS:
        if any(keyword in lowered for keyword in keywords):
            return category
    return None


def _tags(title: str, vocabulary: tuple[str, ...]) -> tuple[str, ...]:
    words = set(re.findall(r"[a-z\-]+", title.lower()))
    return tuple(word for word in vocabulary if word in words)


def _merchant(facts: _PageFacts, product: dict[str, Any] | None, url: str) -> str | None:
    if product:
        for key in ("brand", "seller", "manufacturer"):
            name = _first_string(product.get(key))
            if name:
                return name
    site = facts.meta.get("og:site_name")
    if site:
        return site
    host = urlsplit(url).hostname or ""
    return host.removeprefix("www.") or None


def _strip_site_suffix(title: str) -> str:
    return re.split(r"\s+[|\-–—]\s+", title, maxsplit=1)[0].strip() or title


def _image_url(value: str | None, page_url: str) -> str | None:
    if not value:
        return None
    try:
        resolved = urljoin(page_url, value.strip())
        parts = urlsplit(resolved)
        if (
            parts.scheme in {"https", "http"}
            and parts.hostname
            and not parts.username
            and not parts.password
        ):
            return resolved
    except ValueError:
        pass
    return None


def _currencies(value: Any) -> set[str]:
    if isinstance(value, list):
        return set().union(*(_currencies(item) for item in value))
    if not isinstance(value, dict):
        return set()
    own = {str(value["priceCurrency"]).upper()} if value.get("priceCurrency") else set()
    return own.union(*(_currencies(item) for item in value.values()))


def parse_product_page(html: str, url: str) -> ProductDraft:
    """Best-effort ``ProductDraft`` from raw HTML; never raises on odd markup."""

    collector = _FactCollector()
    collector.feed(html)
    collector.close()
    facts = collector.facts
    product = facts.json_ld[0] if facts.json_ld else None
    text = " ".join(facts.text_parts)

    structured = 0
    title = _first_string(product.get("name")) if product else None
    if not title:
        title = facts.meta.get("og:title") or facts.meta.get("twitter:title")
    if not title and facts.title:
        title = _strip_site_suffix(facts.title)
    if title:
        structured += 1

    price = _json_ld_price(product) if product else None
    if price is None:
        for key in ("product:price:amount", "og:price:amount", "price"):
            price = _to_decimal(facts.meta.get(key))
            if price is not None:
                break
    price_from_text = False
    if price is not None:
        structured += 1
    else:
        price = _price_from_text(text)
        price_from_text = price is not None

    currencies = _currencies(product) | {
        str(facts.meta[key]).upper()
        for key in ("product:price:currency", "og:price:currency", "pricecurrency")
        if facts.meta.get(key)
    }
    foreign_currency = bool(currencies - {"USD", "$"})
    if foreign_currency:
        price = None
        price_from_text = False

    image = next(
        (
            resolved
            for candidate in (
                _first_string(product.get("image")) if product else None,
                facts.meta.get("og:image:secure_url"),
                facts.meta.get("og:image"),
                facts.meta.get("twitter:image"),
                facts.meta.get("twitter:image:src"),
            )
            if (resolved := _image_url(candidate, url))
        ),
        None,
    )
    if image:
        structured += 1

    dimensions = _json_ld_dimensions(product) if product else None
    dims_from_text = False
    if dimensions:
        structured += 1
    else:
        dimensions = _dimensions_from_text(text)
        dims_from_text = dimensions is not None

    category = None
    if product:
        raw_category = _first_string(product.get("category"))
        if raw_category:
            category = guess_category(raw_category)
    if category is None and title:
        category = guess_category(title)
    if category is not None and category not in PRODUCT_CATEGORIES:
        category = None

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

    # A title alone (typical of a JavaScript shell or a bot wall) is not product data.
    has_product_data = price is not None or dimensions is not None or image is not None
    method: ExtractionMethod
    if not has_product_data:
        method = "manual"
    elif dims_from_text or price_from_text:
        method = "text-pattern"
    else:
        method = "structured-data"

    filled = 5 - len(missing)
    confidence = round((structured + 0.6 * (filled - structured)) / 5, 2)

    return ProductDraft(
        source_url=url,
        title=title,
        price_usd=price,
        merchant=_merchant(facts, product, url),
        image_url=image,
        dimensions_m=dimensions,
        category=category,
        style_tags=_tags(title or "", _STYLE_WORDS),
        color_tags=_tags(title or "", _COLOR_WORDS),
        confidence=confidence,
        extraction_method=method,
        missing=missing,
        note=(
            "The listing uses a non-USD currency; enter a confirmed USD price."
            if foreign_currency
            else None
            if method != "manual"
            else "No product data was found on the page; the store may need a browser."
        ),
    )


def visible_text(html: str, limit: int = 6000) -> str:
    """Visible text for the LLM rung, capped so prompts stay small."""

    collector = _FactCollector()
    collector.feed(html)
    collector.close()
    return " ".join(collector.facts.text_parts)[:limit]
