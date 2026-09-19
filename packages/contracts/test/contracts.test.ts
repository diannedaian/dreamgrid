import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  assertValidContract,
  validateFurnitureSpec,
  validateModelAsset,
  validateProduct,
  validateRoomState,
  validateSceneItem,
} from "../src/index.js";
import type {
  FurnitureSpec,
  ModelAsset,
  Product,
  RoomState,
} from "../src/index.js";

const fixtureUrl = new URL("../../../fixtures/", import.meta.url);

async function fixture<T>(name: string): Promise<T> {
  const contents = await readFile(fileURLToPath(new URL(name, fixtureUrl)), "utf8");
  return JSON.parse(contents) as T;
}

describe("DreamGrid contract fixtures", () => {
  it("validates the complete eight-product catalog", async () => {
    const products = await fixture<unknown[]>("products.json");

    expect(products).toHaveLength(8);
    for (const product of products) {
      expect(validateProduct(product), JSON.stringify(validateProduct.errors)).toBe(true);
    }

    const categories = new Set((products as Product[]).map(({ category }) => category));
    expect(categories.size).toBeGreaterThanOrEqual(4);
  });

  it("validates normalized model assets and their product references", async () => {
    const products = await fixture<Product[]>("products.json");
    const assets = await fixture<unknown[]>("model-assets.json");
    const productIds = new Set(products.map(({ id }) => id));
    const assetIds = new Set<string>();

    for (const candidate of assets) {
      assertValidContract("ModelAsset", validateModelAsset, candidate);
      expect(productIds.has(candidate.productId)).toBe(true);
      expect(candidate.pivot).toBe("bottom-center");
      expect(candidate.forwardAxis).toBe("+Z");
      assetIds.add(candidate.id);
    }

    for (const product of products) {
      if (product.modelAssetId) {
        expect(assetIds.has(product.modelAssetId)).toBe(true);
      }
    }
  });

  it("validates room states and keeps every fixture item on the room grid", async () => {
    const state = await fixture<unknown>("room-state.json");
    assertValidContract("RoomState", validateRoomState, state);

    for (const item of state.items) {
      expect(validateSceneItem(item)).toBe(true);
      const [x, y, z] = item.positionM;
      expect(y).toBe(0);
      expect(x / state.room.gridSizeM).toBeCloseTo(
        Math.round(x / state.room.gridSizeM),
      );
      expect(z / state.room.gridSizeM).toBeCloseTo(
        Math.round(z / state.room.gridSizeM),
      );
      expect(Math.abs(x)).toBeLessThanOrEqual(state.room.widthM / 2);
      expect(Math.abs(z)).toBeLessThanOrEqual(state.room.depthM / 2);
    }
  });

  it("validates the empty-room state", async () => {
    const state = await fixture<unknown>("empty-room-state.json");
    expect(validateRoomState(state), JSON.stringify(validateRoomState.errors)).toBe(true);
  });

  it("supports the rehearsed under-budget to over-budget transition", async () => {
    const products = await fixture<Product[]>("products.json");
    const state = await fixture<RoomState>("room-state.json");
    const byId = new Map(products.map((product) => [product.id, product]));
    const subtotal = state.items.reduce(
      (total, item) => total + (byId.get(item.productId)?.priceUsd ?? 0),
      0,
    );
    const lamp = byId.get("product-lamp-mushroom");

    expect(subtotal).toBe(407);
    expect(subtotal).toBeLessThan(state.budgetUsd);
    expect(lamp).toBeDefined();
    expect(subtotal + (lamp?.priceUsd ?? 0)).toBeGreaterThan(state.budgetUsd);
  });

  it("accepts the declarative FurnitureSpec and rejects executable fields", async () => {
    const spec = await fixture<FurnitureSpec>("furniture-spec.json");
    expect(validateFurnitureSpec(spec), JSON.stringify(validateFurnitureSpec.errors)).toBe(
      true,
    );

    const materialIds = new Set(spec.materials.map(({ id }) => id));
    for (const part of spec.parts) {
      expect(materialIds.has(part.materialId)).toBe(true);
    }

    const unsafeCandidate = {
      ...spec,
      python: "import bpy; bpy.ops.wm.open_mainfile(filepath='/tmp/untrusted.blend')",
    };
    expect(validateFurnitureSpec(unsafeCandidate)).toBe(false);
  });

  it("rejects transforms outside the supported quarter turns", () => {
    expect(
      validateSceneItem({
        id: "scene-invalid",
        productId: "product-chair-sage",
        modelAssetId: "asset-chair-sage",
        positionM: [0, 0, 0],
        rotationYDeg: 45,
      }),
    ).toBe(false);
  });

  it("keeps product and asset dimensions aligned in demo fixtures", async () => {
    const products = await fixture<Product[]>("products.json");
    const assets = await fixture<ModelAsset[]>("model-assets.json");
    const byId = new Map(products.map((product) => [product.id, product]));

    for (const asset of assets) {
      expect(asset.dimensionsM).toEqual(byId.get(asset.productId)?.dimensionsM);
    }
  });
});
