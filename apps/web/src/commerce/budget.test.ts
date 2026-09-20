// @vitest-environment node

import type { Product, RoomState } from "@dreamgrid/contracts";
import { describe, expect, it } from "vitest";

import { budgetStatus, roundUsd, summarizeBudget } from "./budget";
import { fixture, loadProducts, loadRoomState, sceneItem, testProduct } from "./testFixtures";

describe("summarizeBudget", () => {
  it("totals the fixture room (bed 199 + desk 129 + shelf 79) against a 450 budget", async () => {
    const summary = summarizeBudget(await loadRoomState(), await loadProducts());

    expect(summary.subtotalUsd).toBe(407);
    expect(summary.budgetUsd).toBe(450);
    expect(summary.remainingUsd).toBe(43);
    expect(summary.status).toBe("under");
    expect(summary.lines.map((line) => line.sceneItemId)).toEqual([
      "scene-bed-1",
      "scene-desk-1",
      "scene-shelf-1",
    ]);
    expect(summary.unpricedItemIds).toEqual([]);
  });

  it("returns zero totals for an empty room", async () => {
    const state = await fixture<RoomState>("empty-room-state.json");
    const summary = summarizeBudget(state, await loadProducts());

    expect(summary.subtotalUsd).toBe(0);
    expect(summary.remainingUsd).toBe(state.budgetUsd);
    expect(summary.status).toBe("under");
    expect(summary.lines).toEqual([]);
  });

  it("goes over budget when the arc floor lamp is added to the fixture room", async () => {
    const state = await loadRoomState();
    const withLamp: RoomState = {
      ...state,
      items: [...state.items, sceneItem({ id: "scene-lamp-1", productId: "product-lamp-floor" })],
    };

    const summary = summarizeBudget(withLamp, await loadProducts());

    expect(summary.subtotalUsd).toBe(469);
    expect(summary.remainingUsd).toBe(-19);
    expect(summary.status).toBe("over");
  });

  it("reports at-limit when the subtotal equals the budget exactly", async () => {
    const state = await loadRoomState();
    const summary = summarizeBudget({ ...state, budgetUsd: 407 }, await loadProducts());

    expect(summary.remainingUsd).toBe(0);
    expect(summary.status).toBe("at-limit");
  });

  it("counts an unknown product as $0 and flags it instead of throwing", async () => {
    const state = await loadRoomState();
    const withUnknown: RoomState = {
      ...state,
      items: [...state.items, sceneItem({ id: "scene-mystery-1", productId: "product-not-in-catalog" })],
    };

    const summary = summarizeBudget(withUnknown, await loadProducts());

    expect(summary.subtotalUsd).toBe(407);
    expect(summary.unpricedItemIds).toEqual(["scene-mystery-1"]);
    expect(summary.lines).toHaveLength(3);
  });

  it("counts the same product once per placed scene item", async () => {
    const state = await loadRoomState();
    const twoBeds: RoomState = {
      ...state,
      items: [
        sceneItem({ id: "scene-bed-1", productId: "product-bed-compact-twin" }),
        sceneItem({ id: "scene-bed-2", productId: "product-bed-compact-twin" }),
      ],
    };

    const summary = summarizeBudget(twoBeds, await loadProducts());

    expect(summary.subtotalUsd).toBe(398);
    expect(summary.lines).toHaveLength(2);
  });

  it("does not mutate the room state or catalog it is given", async () => {
    const state = await loadRoomState();
    const products = await loadProducts();
    const stateSnapshot = JSON.stringify(state);
    const productsSnapshot = JSON.stringify(products);

    summarizeBudget(state, products);

    expect(JSON.stringify(state)).toBe(stateSnapshot);
    expect(JSON.stringify(products)).toBe(productsSnapshot);
  });

  it("rounds fractional prices to cents", () => {
    const products: Product[] = [
      testProduct("a", { priceUsd: 0.1 }),
      testProduct("b", { priceUsd: 0.2 }),
    ];
    const state: RoomState = {
      room: { widthM: 3, depthM: 3, heightM: 2.5, gridSizeM: 0.25, lightingMode: "day" },
      budgetUsd: 1,
      items: [sceneItem({ id: "i-a", productId: "a" }), sceneItem({ id: "i-b", productId: "b" })],
    };

    const summary = summarizeBudget(state, products);

    expect(summary.subtotalUsd).toBe(0.3);
    expect(summary.remainingUsd).toBe(0.7);
  });
});

describe("roundUsd and budgetStatus", () => {
  it("rounds to two decimals", () => {
    expect(roundUsd(0.1 + 0.2)).toBe(0.3);
    expect(roundUsd(19.999)).toBe(20);
  });

  it("maps remaining amounts to a status", () => {
    expect(budgetStatus(1)).toBe("under");
    expect(budgetStatus(0)).toBe("at-limit");
    expect(budgetStatus(-0.01)).toBe("over");
  });
});

