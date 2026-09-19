import type { Product, RoomState } from "@dreamgrid/contracts";

/** One priced scene item. Two placements of the same product produce two lines. */
export type BudgetLine = {
  sceneItemId: string;
  product: Product;
};

export type BudgetStatus = "under" | "at-limit" | "over";

export type BudgetSummary = {
  lines: BudgetLine[];
  /** Scene items whose productId is not in the catalog. Counted as $0, never an error. */
  unpricedItemIds: string[];
  subtotalUsd: number;
  budgetUsd: number;
  /** budgetUsd minus subtotalUsd; negative when over budget. */
  remainingUsd: number;
  status: BudgetStatus;
};

/** Round to cents so repeated float addition never drifts (0.1 + 0.2). */
export function roundUsd(value: number): number {
  return Math.round(value * 100) / 100;
}

export function budgetStatus(remainingUsd: number): BudgetStatus {
  if (remainingUsd < 0) return "over";
  if (remainingUsd === 0) return "at-limit";
  return "under";
}

/**
 * Derive the budget picture from the shared room state and product catalog.
 * Pure: it never mutates its inputs and holds no cart of its own, so it can be
 * recomputed on every scene change.
 */
export function summarizeBudget(
  state: RoomState,
  products: readonly Product[],
): BudgetSummary {
  const productsById = new Map(products.map((product) => [product.id, product]));
  const lines: BudgetLine[] = [];
  const unpricedItemIds: string[] = [];

  for (const item of state.items) {
    const product = productsById.get(item.productId);
    if (product) {
      lines.push({ sceneItemId: item.id, product });
    } else {
      unpricedItemIds.push(item.id);
    }
  }

  const subtotalUsd = roundUsd(
    lines.reduce((sum, line) => sum + line.product.priceUsd, 0),
  );
  const remainingUsd = roundUsd(state.budgetUsd - subtotalUsd);

  return {
    lines,
    unpricedItemIds,
    subtotalUsd,
    budgetUsd: state.budgetUsd,
    remainingUsd,
    status: budgetStatus(remainingUsd),
  };
}
