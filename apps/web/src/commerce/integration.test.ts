import { describe, expect, it } from "vitest";
import { Catalog } from "../catalog/catalog";
import { decodePlan, encodePlan, planFromState } from "../interactions/share";
import { rankAlternatives, fitToBudget } from "./alternatives";
import { summarizeBudget } from "./budget";
import { buildShoppingPlan } from "./shoppingPlan";
import { loadRoomState, sceneItem, testProduct } from "./testFixtures";

describe("commerce integration boundaries", () => {
  it("flags tagged and zero-priced catalog products instead of treating them as free", async () => {
    const products = [testProduct("known", { priceUsd: 40 }), testProduct("drawer", { priceUsd: 0, styleTags: ["price-not-provided"] }), testProduct("placeholder", { priceUsd: 0 }), testProduct("tagged", { priceUsd: 99, styleTags: ["price-not-provided"] })];
    const state = { ...await loadRoomState(), items: products.map(p => sceneItem({ id: p.id, productId: p.id })) };
    const summary = summarizeBudget(state, products);
    expect(summary.subtotalUsd).toBe(40);
    expect(summary.unpricedItemIds).toEqual(["drawer", "placeholder", "tagged"]);
    expect(rankAlternatives(state, products)).toEqual([]);
    expect(fitToBudget(state, products).fitsBudget).toBe(false);
    expect(buildShoppingPlan(state, products).unpricedItemCount).toBe(3);
  });

  it("counts placed products even after their catalog cards are hidden", async () => {
    const catalog = new Catalog();
    const product = testProduct("hidden", { priceUsd: 25 });
    catalog.add([product]); catalog.hide(product.id);
    const state = { ...await loadRoomState(), items: [sceneItem({ id: "placed", productId: product.id })] };
    expect(catalog.entries()).toEqual([]);
    expect(summarizeBudget(state, catalog.allProducts()).subtotalUsd).toBe(25);
  });

  it("round-trips budget without dropping poses, overlap overrides, or room look", async () => {
    const state = await loadRoomState();
    const plan = planFromState(state.room, [], state.items, { budgetUsd: 450.25, openItems: [state.items[0].id], ignored: [state.items[1].id], paint: "#123456", floor: "wood" });
    const restored = decodePlan(encodePlan(plan));
    expect(restored?.b).toBe(450.25);
    expect(restored?.openItems).toEqual(plan.openItems);
    expect(restored?.ign).toEqual(plan.ign);
    expect(restored?.paint).toBe("123456");
    expect(restored?.items).toEqual(plan.items);
  });
});
