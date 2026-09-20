import { describe, expect, it } from "vitest";

import { loadSavedProducts, saveProduct } from "./savedProducts";
import { testProduct } from "./testFixtures";

function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k),
    clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; },
  };
}

describe("savedProducts", () => {
  it("round-trips products and replaces by id", () => {
    const storage = fakeStorage();
    saveProduct(testProduct("a", { priceUsd: 10 }), storage);
    saveProduct(testProduct("b"), storage);
    saveProduct(testProduct("a", { priceUsd: 12 }), storage);
    const list = loadSavedProducts(storage);
    expect(list.map((p) => p.id)).toEqual(["b", "a"]);
    expect(list[1].priceUsd).toBe(12);
  });

  it("is empty without storage or with junk in it", () => {
    expect(loadSavedProducts(undefined)).toEqual([]);
    const storage = fakeStorage();
    storage.setItem("dreamgrid.products", "{not json");
    expect(loadSavedProducts(storage)).toEqual([]);
  });
});
