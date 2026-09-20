// @vitest-environment node

import type { RoomState } from "@dreamgrid/contracts";
import { describe, expect, it } from "vitest";

import { fitToBudget } from "./alternatives";
import { approvePlan, buildShoppingPlan, planToText } from "./shoppingPlan";
import { loadProducts, loadRoomState, sceneItem, testProduct } from "./testFixtures";

const fixedNow = () => new Date("2026-09-19T12:00:00Z");

describe("buildShoppingPlan", () => {
  it("does not count swaps as savings after the swapped item is removed", async () => {
    const products = await loadProducts();
    const state = { ...await loadRoomState(), budgetUsd: 1 };
    const fit = fitToBudget(state, products);
    expect(fit.swaps.length).toBeGreaterThan(0);
    expect(buildShoppingPlan({ ...fit.state, items: [] }, products, fit.swaps).savedUsd).toBe(0);
  });
  it("groups the fixture room into one merchant with three lines totalling 407", async () => {
    const plan = buildShoppingPlan(await loadRoomState(), await loadProducts(), [], fixedNow);

    expect(plan.status).toBe("draft");
    expect(plan.createdAt).toBe("2026-09-19T12:00:00.000Z");
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0].merchant).toBe("DreamGrid Demo Catalog");
    expect(plan.groups[0].lines).toHaveLength(3);
    expect(plan.groups[0].subtotalUsd).toBe(407);
    expect(plan.totalUsd).toBe(407);
    expect(plan.remainingUsd).toBe(43);
    expect(plan.budgetStatus).toBe("under");
    expect(plan.savedUsd).toBe(0);
    expect(plan.unpricedItemCount).toBe(0);
  });

  it("collapses repeated products into a quantity and splits merchants", () => {
    const bedA = testProduct("bed-a", { category: "bed", priceUsd: 100, merchant: "Store A" });
    const lampB = testProduct("lamp-b", { category: "lamp", priceUsd: 20, merchant: "Store B" });
    const state: RoomState = {
      room: { widthM: 3, depthM: 3, heightM: 2.5, gridSizeM: 0.25, lightingMode: "day" },
      budgetUsd: 300,
      items: [
        sceneItem({ id: "1", productId: "bed-a" }),
        sceneItem({ id: "2", productId: "lamp-b" }),
        sceneItem({ id: "3", productId: "bed-a" }),
        sceneItem({ id: "4", productId: "ghost" }),
      ],
    };

    const plan = buildShoppingPlan(state, [bedA, lampB], [], fixedNow);

    expect(plan.groups.map((g) => g.merchant)).toEqual(["Store A", "Store B"]);
    expect(plan.groups[0].lines[0]).toEqual({ product: bedA, quantity: 2, lineTotalUsd: 200 });
    expect(plan.groups[0].subtotalUsd).toBe(200);
    expect(plan.totalUsd).toBe(220);
    expect(plan.unpricedItemCount).toBe(1);
  });

  it("carries applied swaps into savedUsd", async () => {
    const products = await loadProducts();
    const base = await loadRoomState();
    const overBudget: RoomState = {
      ...base,
      items: [...base.items, sceneItem({ id: "scene-lamp-1", productId: "product-lamp-floor" })],
    };
    const fit = fitToBudget(overBudget, products);

    const plan = buildShoppingPlan(fit.state, products, fit.swaps, fixedNow);

    expect(plan.swapsApplied).toEqual(fit.swaps);
    expect(plan.savedUsd).toBe(fit.swaps.reduce((sum, s) => sum + s.savingsUsd, 0));
    expect(plan.budgetStatus).not.toBe("over");
  });
});

describe("approvePlan and planToText", () => {
  it("marks the plan approved without changing its contents", async () => {
    const plan = buildShoppingPlan(await loadRoomState(), await loadProducts(), [], fixedNow);
    const approved = approvePlan(plan);

    expect(approved.status).toBe("approved");
    expect({ ...approved, status: "draft" }).toEqual(plan);
    expect(plan.status).toBe("draft");
  });

  it("renders a readable text plan with links and the no-purchase note", async () => {
    const plan = approvePlan(buildShoppingPlan(await loadRoomState(), await loadProducts(), [], fixedNow));
    const text = planToText(plan);

    expect(text).toContain("DreamGrid shopping plan (approved)");
    expect(text).toContain("Budget $450 | Total $407 | Remaining $43");
    expect(text).toContain("DreamGrid Demo Catalog - $407");
    expect(text).toContain("- Compact Twin Platform Bed: $199 https://example.com/products/compact-twin-bed");
    expect(text).toContain("Nothing is purchased through DreamGrid.");
  });
});
