// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { ProductDraft } from "../lib/commerce/productSourcing";
import { rankSearchResults } from "./productSearch";

function draft(overrides: Partial<ProductDraft> & { sourceUrl: string }): ProductDraft {
  return {
    styleTags: [],
    colorTags: [],
    confidence: 1,
    extractionMethod: "fixture",
    missing: [],
    ...overrides,
  };
}

const results = [
  draft({ sourceUrl: "a", title: "Cheap but big", priceUsd: 30, dimensionsM: [1.8, 0.75, 0.9] }),
  draft({ sourceUrl: "b", title: "Right size", priceUsd: 40, dimensionsM: [1.2, 0.75, 0.6], styleTags: ["minimal"] }),
  draft({ sourceUrl: "c", title: "Over budget", priceUsd: 90, dimensionsM: [1.2, 0.75, 0.6] }),
  draft({ sourceUrl: "d", title: "Unknown price", dimensionsM: [1.2, 0.75, 0.6] }),
];

describe("rankSearchResults", () => {
  it("puts the best-fitting affordable item first and over-budget items last", () => {
    const ranked = rankSearchResults(
      { category: "desk", maxPriceUsd: 43, targetDimensionsM: [1.2, 0.75, 0.6], styleTags: ["minimal"] },
      results,
    );

    expect(ranked[0].draft.title).toBe("Right size");
    expect(ranked[0].reasons).toEqual(["Within your limit", "Size match 100%", "Matches your style"]);
    expect(ranked.at(-1)?.draft.title).toBe("Over budget");
    expect(ranked.at(-1)?.overBudgetUsd).toBe(47);
    expect(ranked.at(-1)?.reasons[0]).toBe("$47 over your limit");
  });

  it("does not hide over-budget results", () => {
    const ranked = rankSearchResults({ category: "desk", maxPriceUsd: 10 }, results);
    expect(ranked).toHaveLength(4);
  });

  it("scores neutrally when the query has no target size or style", () => {
    const ranked = rankSearchResults({ category: "desk" }, results);
    expect(ranked.every((r) => r.score > 0 && r.score <= 1)).toBe(true);
    expect(ranked.find((r) => r.draft.title === "Unknown price")?.reasons).toEqual(["Price unknown"]);
  });
});
