import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type { Product, RoomState, SceneItem } from "@dreamgrid/contracts";

const fixtureUrl = new URL("../../../../fixtures/", import.meta.url);

/** Load a shared fixture from the repository root. Node-environment tests only. */
export async function fixture<T>(name: string): Promise<T> {
  const contents = await readFile(fileURLToPath(new URL(name, fixtureUrl)), "utf8");
  return JSON.parse(contents) as T;
}

export const loadProducts = () => fixture<Product[]>("products.json");
export const loadRoomState = () => fixture<RoomState>("room-state.json");

export function sceneItem(
  overrides: Partial<SceneItem> & Pick<SceneItem, "id" | "productId">,
): SceneItem {
  return {
    modelAssetId: "asset-test",
    positionM: [0, 0, 0],
    rotationYDeg: 0,
    ...overrides,
  };
}

export function testProduct(id: string, overrides: Partial<Product> = {}): Product {
  return {
    id,
    title: `Product ${id}`,
    category: "decor",
    priceUsd: 0,
    merchant: "Test",
    sourceUrl: "https://example.com",
    imageUrl: "/demo-assets/previews/none.webp",
    dimensionsM: [0.5, 0.5, 0.5],
    styleTags: [],
    colorTags: [],
    ...overrides,
  };
}
