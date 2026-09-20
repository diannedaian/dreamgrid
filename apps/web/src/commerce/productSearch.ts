import type { ProductDraft, ProductSearchQuery } from "../lib/commerce/productSourcing";
import { dimensionFit, jaccard } from "./scoring";

export type RankedResult = {
  draft: ProductDraft;
  /** Weighted fit in [0, 1]. */
  score: number;
  overBudgetUsd: number;
  reasons: string[];
};

const WEIGHTS = { price: 0.4, size: 0.4, style: 0.2 } as const;

function priceFit(price: number | undefined, maxPriceUsd: number | undefined): number {
  if (price === undefined || !Number.isFinite(price) || price <= 0) return 0.3; // unknown: neither rewarded nor thrown out
  if (maxPriceUsd === undefined) return 0.7;
  if (maxPriceUsd <= 0) return 0;
  if (price <= maxPriceUsd) return 1 - (price / maxPriceUsd) * 0.3; // cheaper is slightly better
  return Math.max(0, 1 - (price - maxPriceUsd) / maxPriceUsd);
}

/**
 * Rank search hits by how well they fit the request: price against the
 * budget, size against the target, and style tags. Results over budget are
 * sorted after the ones that fit but never hidden, so the closest option is
 * always visible.
 */
export function rankSearchResults(
  query: ProductSearchQuery,
  results: readonly ProductDraft[],
): RankedResult[] {
  const ranked = results.map((draft): RankedResult => {
    const knownPrice = draft.priceUsd !== undefined && Number.isFinite(draft.priceUsd) && draft.priceUsd > 0;
    const price = priceFit(knownPrice ? draft.priceUsd : undefined, query.maxPriceUsd);
    const size =
      query.targetDimensionsM && draft.dimensionsM
        ? dimensionFit(query.targetDimensionsM, draft.dimensionsM)
        : 0.5;
    const style = query.styleTags?.length ? jaccard(query.styleTags, draft.styleTags) : 0.5;
    const overBudgetUsd =
      knownPrice && query.maxPriceUsd !== undefined
        ? Math.max(0, Math.round((draft.priceUsd! - query.maxPriceUsd) * 100) / 100)
        : 0;

    const reasons: string[] = [];
    if (knownPrice && overBudgetUsd > 0) reasons.push(`$${overBudgetUsd} over your limit`);
    else if (knownPrice && query.maxPriceUsd !== undefined) reasons.push("Within your limit");
    if (query.targetDimensionsM && draft.dimensionsM) {
      reasons.push(`Size match ${Math.round(size * 100)}%`);
    } else if (query.targetDimensionsM) {
      reasons.push("Size unknown");
    }
    if (query.styleTags?.length && style > 0) reasons.push("Matches your style");

    return {
      draft,
      score: WEIGHTS.price * price + WEIGHTS.size * size + WEIGHTS.style * style,
      overBudgetUsd,
      reasons,
    };
  });

  return ranked.sort(
    (a, b) =>
      Number(a.overBudgetUsd > 0) - Number(b.overBudgetUsd > 0) || b.score - a.score,
  );
}
