import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { Catalog } from "../catalog/catalog";
import { MANUAL_SOURCE_URL, createCatalogAdder, productIdFor } from "./catalogAdd";
import { testProduct } from "./testFixtures";

const product = testProduct("p-desk", { sourceUrl: "https://shop.example/desk", modelAssetId: undefined });

describe("source product generation handoff", () => {
  it("keeps stable page IDs and gives manual products unique IDs", async () => {
    expect(await productIdFor(product.sourceUrl)).toBe(`imp-${createHash("sha1").update(product.sourceUrl).digest("hex").slice(0, 16)}`);
    expect(await productIdFor(MANUAL_SOURCE_URL)).toMatch(/^product-import-/);
    expect(await productIdFor("")).toMatch(/^product-import-/);
  });

  it("saves details and opens image confirmation without requesting a URL model", async () => {
    const catalog = new Catalog(), save = vi.fn(), openGeneration = vi.fn();
    const adder = createCatalogAdder({ catalog, save, openGeneration });
    const outcome = await adder.add(product).model;
    expect(outcome.kind).toBe("pending");
    expect(catalog.get(product.id)?.asset).toBeUndefined();
    expect(openGeneration).toHaveBeenCalledWith(product);
    expect(save).toHaveBeenCalledWith(product);
  });

  it("also opens image generation for manually entered products", async () => {
    const openGeneration = vi.fn();
    const manual = { ...product, sourceUrl: "" };
    await createCatalogAdder({ catalog: new Catalog(), openGeneration, save: () => {} }).add(manual).model;
    expect(openGeneration).toHaveBeenCalledWith(manual);
  });

  it("retains a ready model and its reviewed size when the same source is added again", async () => {
    const catalog = new Catalog(), openGeneration = vi.fn();
    const asset = { id: "asset-x", productId: product.id, glbUrl: "/api/v1/models/assets/x.glb", dimensionsM: [1, 2, 3] as [number, number, number], pivot: "bottom-center" as const, forwardAxis: "+Z" as const, generationMethod: "gpt-blender" as const, status: "ready" as const, disclosure: "" };
    catalog.add([{ ...product, modelAssetId: asset.id }], [asset]);
    const result = createCatalogAdder({ catalog, openGeneration, save: () => {} }).add({ ...product, priceUsd: 50, styleTags: ["model-pending"] });
    expect(result.product.priceUsd).toBe(50); // the listing's price wins over the importer's
    expect(result.product.dimensionsM).toEqual(asset.dimensionsM);
    expect(result.product.styleTags).not.toContain("model-pending");
    expect((await result.model).kind).toBe("model");
    expect(openGeneration).not.toHaveBeenCalled();
  });

  it("never substitutes a box when opening generation fails", async () => {
    const adder = createCatalogAdder({ catalog: new Catalog(), openGeneration: () => { throw new Error("busy"); }, save: () => {} });
    expect(await adder.add(product).model).toEqual({ kind: "pending", note: "Model not generated: busy" });
  });
});
