import type { Product, RoomState, SceneItem } from "@dreamgrid/contracts";

import { roundUsd, summarizeBudget } from "./budget";
import { footprintFit, sharedTags, styleSimilarity } from "./scoring";

export type Alternative = {
  sceneItemId: string;
  from: Product;
  to: Product;
  savingsUsd: number;
  /** Weighted fit in [0, 1]; higher is a better swap. */
  score: number;
  reasons: string[];
};

export type FitToBudgetResult = {
  state: RoomState;
  swaps: Alternative[];
  fitsBudget: boolean;
  remainingUsd: number;
};

/**
 * Scene items must reference a non-empty model asset. When a cheaper product
 * has no asset yet, the swap uses this id; the loader should render its
 * placeholder cube for it.
 */
export const PLACEHOLDER_MODEL_ASSET_ID = "asset-placeholder";

const WEIGHTS = { savings: 0.45, style: 0.25, footprint: 0.3 } as const;

function scoreAlternative(sceneItemId: string, from: Product, to: Product): Alternative {
  const savingsUsd = roundUsd(from.priceUsd - to.priceUsd);
  const savingsRatio = from.priceUsd > 0 ? savingsUsd / from.priceUsd : 0;
  const style = styleSimilarity(from, to);
  const footprint = footprintFit(from, to);
  const score =
    WEIGHTS.savings * savingsRatio + WEIGHTS.style * style + WEIGHTS.footprint * footprint;

  const reasons = [
    `Saves $${savingsUsd} (${Math.round(savingsRatio * 100)}%)`,
    `Same category: ${to.category}`,
  ];
  const tags = sharedTags(from, to);
  if (tags.length > 0) reasons.push(`Shares style: ${tags.join(", ")}`);
  reasons.push(
    footprint >= 1 ? "Fits the current footprint" : "Larger than the current item",
  );

  return { sceneItemId, from, to, savingsUsd, score, reasons };
}

/**
 * Every cheaper, same-category replacement for every priced item in the room,
 * best first. Items with no cheaper option simply produce nothing.
 */
export function rankAlternatives(
  state: RoomState,
  products: readonly Product[],
): Alternative[] {
  const { lines } = summarizeBudget(state, products);
  const alternatives: Alternative[] = [];

  for (const line of lines) {
    for (const candidate of products) {
      if (candidate.id === line.product.id) continue;
      if (candidate.category !== line.product.category) continue;
      if (candidate.priceUsd >= line.product.priceUsd) continue;
      alternatives.push(scoreAlternative(line.sceneItemId, line.product, candidate));
    }
  }

  return alternatives.sort((a, b) => b.score - a.score || b.savingsUsd - a.savingsUsd);
}

/** Return a new room state with one item's product replaced; position and rotation stay. */
export function applySwap(state: RoomState, alternative: Alternative): RoomState {
  const items = state.items.map((item): SceneItem => {
    if (item.id !== alternative.sceneItemId) return item;
    return {
      ...item,
      productId: alternative.to.id,
      modelAssetId: alternative.to.modelAssetId ?? PLACEHOLDER_MODEL_ASSET_ID,
    };
  });
  return { ...state, items };
}

/**
 * Greedily apply the best-scoring swap until the room is no longer over
 * budget. Each scene item is swapped at most once and nothing is removed, so
 * the result may still be over budget; `fitsBudget` says whether it worked.
 */
export function fitToBudget(
  state: RoomState,
  products: readonly Product[],
): FitToBudgetResult {
  let current = state;
  const swaps: Alternative[] = [];
  const swappedItemIds = new Set<string>();

  for (;;) {
    const summary = summarizeBudget(current, products);
    if (summary.status !== "over") {
      return { state: current, swaps, fitsBudget: true, remainingUsd: summary.remainingUsd };
    }

    const next = rankAlternatives(current, products).find(
      (alternative) => !swappedItemIds.has(alternative.sceneItemId),
    );
    if (!next) {
      return { state: current, swaps, fitsBudget: false, remainingUsd: summary.remainingUsd };
    }

    current = applySwap(current, next);
    swaps.push(next);
    swappedItemIds.add(next.sceneItemId);
  }
}
