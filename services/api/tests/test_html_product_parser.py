"""Parser tests against small inline pages shaped like real stores. No network."""

from decimal import Decimal

from dreamgrid_api.adapters.commerce.html_product_parser import (
    guess_category,
    parse_dimensions_text,
    parse_product_page,
    visible_text,
)

JSON_LD_PAGE = """
<html><head><title>LINNMON Desk, white | Example Store</title>
<meta property="og:site_name" content="Example Store">
<script type="application/ld+json">
{"@context":"https://schema.org","@graph":[
  {"@type":"Organization","name":"Example"},
  {"@type":"Product","name":"LINNMON Desk, white, 47 1/4x23 5/8\\"",
   "image":["https://cdn.example/linnmon.jpg"],
   "brand":{"@type":"Brand","name":"Example Store"},
   "offers":{"@type":"Offer","price":"49.99","priceCurrency":"USD"},
   "width":{"@type":"QuantitativeValue","value":120,"unitCode":"CMT"},
   "height":{"@type":"QuantitativeValue","value":74,"unitCode":"CMT"},
   "depth":{"@type":"QuantitativeValue","value":60,"unitCode":"CMT"}}
]}
</script></head>
<body><h1>LINNMON Desk</h1><p>A simple white desk.</p></body></html>
"""

OG_TEXT_PAGE = """
<html><head><title>Mushroom Lamp - Cozy Corner</title>
<meta property="og:title" content="Mushroom Lamp">
<meta property="og:image" content="https://cdn.example/mushroom.jpg">
<meta property="product:price:amount" content="45.00">
<meta property="product:price:currency" content="USD">
<style>.x{display:none}</style>
</head><body>
<script>window.__x = {"dimensions": "9 x 9 x 9 in"};</script>
<h1>Mushroom Lamp</h1>
<p>Was $60, now $45.</p>
<h2>Product details</h2>
<p>Dimensions: 11"W x 11"D x 15"H. Warm coral shade.</p>
</body></html>
"""

BARE_PAGE = "<html><head><title>Access Denied</title></head><body>Blocked</body></html>"


def test_json_ld_page_is_structured_data() -> None:
    draft = parse_product_page(JSON_LD_PAGE, "https://www.example.com/p/linnmon")

    assert draft.title == 'LINNMON Desk, white, 47 1/4x23 5/8"'
    assert draft.price_usd == Decimal("49.99")
    assert draft.image_url == "https://cdn.example/linnmon.jpg"
    assert draft.dimensions_m == (1.2, 0.74, 0.6)
    assert draft.category == "desk"
    assert draft.merchant == "Example Store"
    assert "white" in draft.color_tags
    assert draft.extraction_method == "structured-data"
    assert draft.missing == ()
    assert draft.confidence >= 0.9  # category is a keyword guess, so not quite 1.0


def test_meta_tags_plus_text_dimensions() -> None:
    draft = parse_product_page(OG_TEXT_PAGE, "https://cozy.example/lamp")

    assert draft.title == "Mushroom Lamp"
    assert draft.price_usd == Decimal("45.00")
    assert draft.image_url == "https://cdn.example/mushroom.jpg"
    # 11"W x 11"D x 15"H -> (width, height, depth) meters
    assert draft.dimensions_m == (0.279, 0.381, 0.279)
    assert draft.category == "lamp"
    assert draft.extraction_method == "text-pattern"
    assert draft.missing == ()
    assert draft.merchant == "cozy.example"


def test_text_price_is_used_only_when_nothing_structured_exists() -> None:
    page = "<html><body><h1>Blue Chair</h1><p>Only $89.00 today</p></body></html>"
    draft = parse_product_page(page, "https://shop.example/chair")

    assert draft.title is None  # no <title>, no og:title, no JSON-LD name
    assert draft.price_usd == Decimal("89.00")
    assert draft.extraction_method == "text-pattern"
    assert "title" in draft.missing
    assert "dimensionsM" in draft.missing


def test_foreign_currency_does_not_fall_through_to_a_dollar_price() -> None:
    for html in (
        JSON_LD_PAGE.replace('"USD"', '"CAD"').replace("A simple white desk.", "$49.99"),
        OG_TEXT_PAGE.replace('content="USD"', 'content="AUD"'),
    ):
        draft = parse_product_page(html, "https://shop.example/product")
        assert draft.price_usd is None
        assert "priceUsd" in draft.missing
        assert draft.note and "currency" in draft.note


def test_bare_page_yields_manual_draft_with_missing_fields() -> None:
    draft = parse_product_page(BARE_PAGE, "https://www.amazon.com/dp/x")

    assert draft.title == "Access Denied"
    assert draft.price_usd is None
    assert draft.dimensions_m is None
    assert set(draft.missing) >= {"priceUsd", "imageUrl", "dimensionsM"}
    assert draft.merchant == "amazon.com"
    assert draft.extraction_method == "manual"  # a title alone is not product data
    assert draft.note is not None and "browser" in draft.note


def test_malformed_json_ld_and_odd_markup_do_not_raise() -> None:
    page = '<html><script type="application/ld+json">{not json</script><p>x<b>y</html>'
    draft = parse_product_page(page, "https://shop.example/x")
    assert draft.source_url == "https://shop.example/x"


def test_parse_dimensions_text_orders_width_height_depth() -> None:
    assert parse_dimensions_text("120 x 60 x 75 cm") == (1.2, 0.75, 0.6)
    assert parse_dimensions_text('47.2"W x 23.6"D x 29.5"H') == (1.199, 0.749, 0.599)
    assert parse_dimensions_text("H 75cm x W 120cm x D 60cm") == (1.2, 0.75, 0.6)
    assert parse_dimensions_text("no sizes here") is None


def test_guess_category() -> None:
    assert guess_category("Slim Arc Floor Lamp") == "lamp"
    assert guess_category("Two-by-Two Cube Shelf") == "shelf"
    assert guess_category("Cloud Woven Rug") == "decor"
    assert guess_category("Something else") is None


def test_listing_images_resolve_relative_and_protocol_relative_urls() -> None:
    for value, expected in (
        ("/photos/chair.jpg", "https://shop.example/photos/chair.jpg"),
        ("//cdn.example/chair.jpg", "https://cdn.example/chair.jpg"),
        ("photos/chair.jpg", "https://shop.example/products/photos/chair.jpg"),
    ):
        draft = parse_product_page(
            f'<meta property="og:image" content="{value}">',
            "https://shop.example/products/chair",
        )
        assert draft.image_url == expected


def test_listing_images_reject_unsafe_urls() -> None:
    for value in (
        "javascript:alert(1)",
        "data:image/svg+xml,test",
        "https://user:pass@cdn.example/x",
    ):
        draft = parse_product_page(
            f'<meta property="og:image" content="{value}">', "https://shop.example/chair"
        )
        assert draft.image_url is None
        assert "imageUrl" in draft.missing


def test_visible_text_skips_scripts_and_styles() -> None:
    text = visible_text(OG_TEXT_PAGE)
    assert "Mushroom Lamp" in text
    assert "__x" not in text
    assert "display:none" not in text
