import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { Catalog } from "../catalog/catalog";
import { MANUAL_SOURCE_URL, createCatalogAdder, productIdFor } from "./catalogAdd";
import { testProduct } from "./testFixtures";

describe("productIdFor", () => {
  it("derives the same id Cindy's importer writes to catalog.json (imp- + sha1 prefix)", async () => {
    const url = "https://www.ikea.com/us/en/p/micke-desk-white-80354276/";
    const expected = `imp-${createHash("sha1").update(url).digest("hex").slice(0, 16)}`;
    expect(await productIdFor(url)).toBe(expected);
  });

  it("gives hand-typed products a fresh id", async () => {
    expect(await productIdFor(MANUAL_SOURCE_URL)).toMatch(/^product-import-/);
    expect(await productIdFor("")).toMatch(/^product-import-/);
  });
});

describe("createCatalogAdder", () => {
  const product = testProduct("p-desk", { sourceUrl: "https://shop.example/desk", modelAssetId: undefined });

  it("adds the product at once and attaches the model when the importer succeeds", async () => {
    const catalog = new Catalog();
    const save = vi.fn();
    const asset = { id: "asset-x", productId: "other", glbUrl: "spec:/x.json", dimensionsM: [1, 1, 1] as [number, number, number], pivot: "bottom-center" as const, forwardAxis: "+Z" as const, generationMethod: "gpt-blender" as const, status: "ready" as const, disclosure: "" };
    const importModel = vi.fn().mockResolvedValue({ product: { ...product, id: "imp-x", priceUsd: 999 }, asset });
    const adder = createCatalogAdder({ catalog, importModel, save });

    const { model } = adder.add(product);
    expect(catalog.get("p-desk")?.product.priceUsd).toBe(product.priceUsd);
    expect(catalog.get("p-desk")?.asset).toBeUndefined();

    const outcome = await model;
    expect(outcome.kind).toBe("model");
    expect(importModel).toHaveBeenCalledWith(product.sourceUrl);
    const entry = catalog.get("p-desk")!;
    expect(entry.product.priceUsd).toBe(product.priceUsd); // the listing's price wins over the importer's
    expect(entry.product.modelAssetId).toBe("asset-x");
    expect(entry.asset?.productId).toBe("p-desk");
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("keeps the sized box when the importer fails", async () => {
    const catalog = new Catalog();
    const adder = createCatalogAdder({ catalog, importModel: vi.fn().mockRejectedValue(new Error("blocked")), save: () => {} });
    const outcome = await adder.add(product).model;
    expect(outcome.kind).toBe("box");
    expect(outcome.note).toContain("blocked");
    expect(catalog.get("p-desk")?.asset).toBeUndefined();
  });

  it("never asks for a model for a hand-typed product", async () => {
    const catalog = new Catalog();
    const importModel = vi.fn();
    const adder = createCatalogAdder({ catalog, importModel, save: () => {} });
    const outcome = await adder.add({ ...product, sourceUrl: MANUAL_SOURCE_URL }).model;
    expect(outcome.kind).toBe("box");
    expect(importModel).not.toHaveBeenCalled();
  });
});
