// @vitest-environment node

import type { RoomState } from "@dreamgrid/contracts";
import { describe, expect, it } from "vitest";

import {
  PLACEHOLDER_MODEL_ASSET_ID,
  applySwap,
  fitToBudget,
  rankAlternatives,
  revertSwaps,
} from "./alternatives";
import { summarizeBudget } from "./budget";
import { loadProducts, loadRoomState, sceneItem, testProduct } from "./testFixtures";

async function roomWithArcLamp(): Promise<RoomState> {
  const state = await loadRoomState();
  return {
    ...state,
    items: [
      ...state.items,
      sceneItem({ id: "scene-lamp-1", productId: "product-lamp-floor", positionM: [1, 0, 1] }),
    ],
  };
}

describe("rankAlternatives", () => {
  it("suggests the mushroom lamp for the arc lamp and the rolling cart for the cube shelf", async () => {
    const alternatives = rankAlternatives(await roomWithArcLamp(), await loadProducts());

    const lamp = alternatives.find((a) => a.sceneItemId === "scene-lamp-1");
    const shelf = alternatives.find((a) => a.sceneItemId === "scene-shelf-1");

    expect(lamp?.to.id).toBe("product-lamp-mushroom");
    expect(lamp?.savingsUsd).toBe(17);
    expect(shelf?.to.id).toBe("product-shelf-cart");
    expect(shelf?.savingsUsd).toBe(40);
  });

  it("offers nothing for items with no cheaper same-category product", async () => {
    const alternatives = rankAlternatives(await loadRoomState(), await loadProducts());

    expect(alternatives.some((a) => a.sceneItemId === "scene-bed-1")).toBe(false);
    expect(alternatives.some((a) => a.sceneItemId === "scene-desk-1")).toBe(false);
  });

  it("never suggests a more expensive or different-category product", async () => {
    const products = await loadProducts();
    const alternatives = rankAlternatives(await roomWithArcLamp(), products);

    for (const alternative of alternatives) {
      expect(alternative.to.priceUsd).toBeLessThan(alternative.from.priceUsd);
      expect(alternative.to.category).toBe(alternative.from.category);
      expect(alternative.savingsUsd).toBeGreaterThan(0);
    }
  });

  it("returns the best swap first and explains it", async () => {
    const alternatives = rankAlternatives(await roomWithArcLamp(), await loadProducts());

    expect(alternatives.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < alternatives.length; i += 1) {
      expect(alternatives[i - 1].score).toBeGreaterThanOrEqual(alternatives[i].score);
    }
    expect(alternatives[0].reasons[0]).toMatch(/^Saves \$\d+/);
  });

  it("prefers a candidate with matching style and a fitting footprint at equal savings", () => {
    const current = testProduct("current", {
      category: "chair",
      priceUsd: 100,
      dimensionsM: [0.6, 0.9, 0.6],
      styleTags: ["modern", "soft"],
    });
    const stylish = testProduct("stylish", {
      category: "chair",
      priceUsd: 60,
      dimensionsM: [0.5, 0.9, 0.5],
      styleTags: ["modern", "soft"],
    });
    const bulky = testProduct("bulky", {
      category: "chair",
      priceUsd: 60,
      dimensionsM: [1.2, 0.9, 1.2],
      styleTags: ["industrial"],
    });
    const state: RoomState = {
      room: { widthM: 3, depthM: 3, heightM: 2.5, gridSizeM: 0.25, lightingMode: "day" },
      budgetUsd: 50,
      items: [sceneItem({ id: "chair-1", productId: "current" })],
    };

    const [best, worst] = rankAlternatives(state, [current, stylish, bulky]);

    expect(best.to.id).toBe("stylish");
    expect(worst.to.id).toBe("bulky");
    expect(worst.reasons).toContain("Larger than the current item");
  });
});

describe("applySwap", () => {
  it("replaces only the product and asset, keeping id, position, and rotation", async () => {
    const state = await roomWithArcLamp();
    const products = await loadProducts();
    const lampSwap = rankAlternatives(state, products).find((a) => a.sceneItemId === "scene-lamp-1");
    if (!lampSwap) throw new Error("expected a lamp alternative");

    const next = applySwap(state, lampSwap);
    const original = state.items.find((i) => i.id === "scene-lamp-1");
    const swapped = next.items.find((i) => i.id === "scene-lamp-1");

    expect(swapped).toEqual({
      ...original,
      productId: "product-lamp-mushroom",
      modelAssetId: "asset-lamp-mushroom",
    });
    expect(next.items).toHaveLength(state.items.length);
    expect(next.room).toBe(state.room);
    expect(state.items.find((i) => i.id === "scene-lamp-1")?.productId).toBe("product-lamp-floor");
  });

  it("uses the placeholder asset id when the cheaper product has no model asset", () => {
    const from = testProduct("from", { category: "lamp", priceUsd: 80, modelAssetId: "asset-from" });
    const to = testProduct("to", { category: "lamp", priceUsd: 20 });
    const state: RoomState = {
      room: { widthM: 3, depthM: 3, heightM: 2.5, gridSizeM: 0.25, lightingMode: "day" },
      budgetUsd: 50,
      items: [sceneItem({ id: "lamp-1", productId: "from", modelAssetId: "asset-from" })],
    };

    const [alternative] = rankAlternatives(state, [from, to]);
    const next = applySwap(state, alternative);

    expect(next.items[0].modelAssetId).toBe(PLACEHOLDER_MODEL_ASSET_ID);
  });
});

describe("fitToBudget", () => {
  it("brings the over-budget fixture room under budget with the fewest swaps", async () => {
    const state = await roomWithArcLamp();
    const products = await loadProducts();
    expect(summarizeBudget(state, products).status).toBe("over");

    const result = fitToBudget(state, products);

    expect(result.fitsBudget).toBe(true);
    expect(result.remainingUsd).toBeGreaterThanOrEqual(0);
    expect(result.swaps.length).toBeGreaterThanOrEqual(1);
    expect(summarizeBudget(result.state, products).status).not.toBe("over");
    expect(new Set(result.swaps.map((s) => s.sceneItemId)).size).toBe(result.swaps.length);
  });

  it("leaves an already affordable room untouched", async () => {
    const state = await loadRoomState();
    const result = fitToBudget(state, await loadProducts());

    expect(result.state).toBe(state);
    expect(result.swaps).toEqual([]);
    expect(result.fitsBudget).toBe(true);
  });

  it("reports failure without removing items when swaps cannot cover the gap", async () => {
    const state = { ...(await loadRoomState()), budgetUsd: 100 };
    const result = fitToBudget(state, await loadProducts());

    expect(result.fitsBudget).toBe(false);
    expect(result.remainingUsd).toBeLessThan(0);
    expect(result.state.items).toHaveLength(state.items.length);
  });
});

describe("revertSwaps", () => {
  it("restores the original products after fitToBudget", async () => {
    const state = await roomWithArcLamp();
    const products = await loadProducts();
    const fit = fitToBudget(state, products);
    expect(fit.swaps.length).toBeGreaterThan(0);

    const reverted = revertSwaps(fit.state, fit.swaps);

    expect(reverted.items).toEqual(state.items);
    expect(summarizeBudget(reverted, products).subtotalUsd).toBe(469);
  });

  it("skips items that were removed or changed after the swap", async () => {
    const state = await roomWithArcLamp();
    const products = await loadProducts();
    const fit = fitToBudget(state, products);
    const [firstSwap] = fit.swaps;

    const withoutItem = {
      ...fit.state,
      items: fit.state.items.filter((item) => item.id !== firstSwap.sceneItemId),
    };
    const reverted = revertSwaps(withoutItem, fit.swaps);

    expect(reverted.items.some((item) => item.id === firstSwap.sceneItemId)).toBe(false);
    expect(reverted.items).toHaveLength(withoutItem.items.length);
  });

  it("returns the same state when there is nothing to revert", async () => {
    const state = await loadRoomState();
    expect(revertSwaps(state, [])).toBe(state);
  });
});
