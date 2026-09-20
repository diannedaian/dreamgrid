// @vitest-environment node

import { describe, expect, it } from "vitest";

import { manualDraft, type ProductDraft } from "../lib/commerce/productSourcing";
import { buildProduct, fieldsFromDraft, validateFields } from "./draftToProduct";

const filled = {
  ...fieldsFromDraft(manualDraft("https://www.ikea.com/us/en/p/desk", "")),
  title: "Linnmon Desk",
  priceUsd: "49.99",
  category: "desk" as const,
  width: "47.25",
  height: "29.125",
  depth: "23.625",
  unit: "in" as const,
  styleTags: "Minimal, white, minimal",
};

describe("fieldsFromDraft", () => {
  it("prefills from a draft, converting meters to the display unit", () => {
    const draft: ProductDraft = {
      sourceUrl: "https://shop.example/x",
      title: "Desk",
      priceUsd: 120,
      dimensionsM: [1.2, 0.75, 0.6],
      category: "desk",
      styleTags: ["minimal"],
      colorTags: [],
      confidence: 0.9,
      extractionMethod: "structured-data",
      missing: [],
    };

    const fields = fieldsFromDraft(draft, "cm");

    expect(fields).toMatchObject({
      title: "Desk",
      priceUsd: "120",
      category: "desk",
      width: "120",
      height: "75",
      depth: "60",
      unit: "cm",
      merchant: "shop.example",
      styleTags: "minimal",
    });
  });

  it("leaves unknown fields empty", () => {
    const fields = fieldsFromDraft(manualDraft("", ""));
    expect(fields.title).toBe("");
    expect(fields.width).toBe("");
    expect(fields.merchant).toBe("");
  });
});

describe("validateFields", () => {
  it("requires title, price, and all three dimensions", () => {
    const errors = validateFields(fieldsFromDraft());
    expect(Object.keys(errors).sort()).toEqual(["depth", "height", "priceUsd", "title", "width"]);
  });

  it("accepts a price of 0 (unpriced) but not a negative one", () => {
    expect(validateFields({ ...filled, priceUsd: "0" }).priceUsd).toBeUndefined();
    expect(validateFields({ ...filled, priceUsd: "-1" }).priceUsd).toBeDefined();
  });
});

describe("buildProduct", () => {
  it("creates a contract-valid product in meters with deduplicated tags", () => {
    const product = buildProduct(filled, "product-import-test");

    expect(product).toEqual({
      id: "product-import-test",
      title: "Linnmon Desk",
      category: "desk",
      priceUsd: 49.99,
      merchant: "ikea.com",
      sourceUrl: "https://www.ikea.com/us/en/p/desk",
      imageUrl: "/demo-assets/previews/placeholder.webp",
      dimensionsM: [1.2, 0.74, 0.6],
      styleTags: ["minimal", "white", "model-pending"],
      colorTags: [],
    });
  });

  it("uses defaults for merchant and source when entered by hand", () => {
    const product = buildProduct({ ...filled, sourceUrl: "", merchant: "" }, "p");
    expect(product.merchant).toBe("Manual entry");
    expect(product.sourceUrl).toBe("");
  });

  it("refuses a product the shared schema rejects", () => {
    expect(() => buildProduct({ ...filled, title: "   " }, "p")).toThrow(/Enter a title/);
  });
});
