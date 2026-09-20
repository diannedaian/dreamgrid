// @vitest-environment node

import { describe, expect, it } from "vitest";

import { findPrice, parseProductText } from "./productText";

const AMAZON_BLOB = `SONGMICS Computer Desk, 47.2 Inch Home Office Desk, Study Writing Table
Visit the SONGMICS Store
4.6 out of 5 stars
List Price: $129.99
Price: $89.99
Save: $40.00 (31%)
Product information
Product Dimensions: 23.6"D x 47.2"W x 29.5"H
Item Weight: 35 pounds
Color: Rustic Brown`;

const IKEA_BLOB = `MICKE
Desk, white, 105x50 cm
$89.99
Measurements
Width: 105 cm
Depth: 50 cm
Height: 75 cm`;

describe("parseProductText", () => {
  it("reads an Amazon product-information paste", () => {
    const parsed = parseProductText(AMAZON_BLOB, "in");

    expect(parsed.title).toBe(
      "SONGMICS Computer Desk, 47.2 Inch Home Office Desk, Study Writing Table",
    );
    expect(parsed.priceUsd).toBe("89.99");
    expect(parsed.category).toBe("desk");
    expect(parsed.unit).toBe("in");
    expect(parsed.width).toBe("47.2");
    expect(parsed.depth).toBe("23.6");
    expect(parsed.height).toBe("29.5");
    expect(parsed.found).toEqual(["dimensions", "priceUsd", "title", "category"]);
  });

  it("reads an IKEA-style paste with the dimensions in the title", () => {
    const parsed = parseProductText(IKEA_BLOB, "cm");

    expect(parsed.priceUsd).toBe("89.99");
    expect(parsed.category).toBe("desk");
    // "Width: 105 cm / Depth: 50 cm / Height: 75 cm" is not an x-separated triple,
    // so dimensions are not claimed rather than guessed.
    expect(parsed.found).not.toContain("dimensions");
  });

  it("returns nothing for empty text", () => {
    expect(parseProductText("   ", "in")).toEqual({ found: [] });
  });
});

describe("findPrice", () => {
  it("prefers the selling price over list price and savings", () => {
    expect(findPrice("List Price: $129.99 Price: $89.99 Save: $40.00")).toBe(89.99);
    expect(findPrice("Was $60, now $45")).toBe(45);
    expect(findPrice("Typical price: $1,299.00")).toBe(1299);
  });

  it("falls back to any dollar amount", () => {
    expect(findPrice("Only $19.50 today")).toBe(19.5);
    expect(findPrice("no money here")).toBeUndefined();
  });
});

describe("parseProductText title guard", () => {
  it("does not treat arbitrary text as a title", () => {
    expect(parseProductText("hello there", "in")).toEqual({ found: [] });
  });
});
