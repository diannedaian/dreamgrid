import type { Product, RoomState } from "@dreamgrid/contracts";

import type { Alternative } from "./alternatives";
import { type BudgetStatus, roundUsd, summarizeBudget } from "./budget";
import { formatUsd } from "./format";

export type PlanLine = {
  product: Product;
  quantity: number;
  lineTotalUsd: number;
};

/** Lines for one store, so the user can open each merchant once. */
export type MerchantGroup = {
  merchant: string;
  lines: PlanLine[];
  subtotalUsd: number;
};

export type ShoppingPlan = {
  createdAt: string;
  status: "draft" | "approved";
  budgetUsd: number;
  totalUsd: number;
  remainingUsd: number;
  budgetStatus: BudgetStatus;
  groups: MerchantGroup[];
  unpricedItemCount: number;
  swapsApplied: Alternative[];
  /** Total savings from the swaps the user accepted; the headline impact number. */
  savedUsd: number;
};

/**
 * Freeze the current room into a shopping plan. Nothing is purchased; the plan
 * is a per-merchant list with links, totals, and what the swaps saved.
 */
export function buildShoppingPlan(
  state: RoomState,
  products: readonly Product[],
  swapsApplied: readonly Alternative[] = [],
  now: () => Date = () => new Date(),
): ShoppingPlan {
  const summary = summarizeBudget(state, products);

  const groupsByMerchant = new Map<string, Map<string, PlanLine>>();
  for (const { product } of summary.lines) {
    let lines = groupsByMerchant.get(product.merchant);
    if (!lines) {
      lines = new Map();
      groupsByMerchant.set(product.merchant, lines);
    }
    const line = lines.get(product.id) ?? { product, quantity: 0, lineTotalUsd: 0 };
    line.quantity += 1;
    line.lineTotalUsd = roundUsd(line.quantity * product.priceUsd);
    lines.set(product.id, line);
  }

  const groups: MerchantGroup[] = [...groupsByMerchant.entries()].map(([merchant, lines]) => {
    const groupLines = [...lines.values()];
    return {
      merchant,
      lines: groupLines,
      subtotalUsd: roundUsd(groupLines.reduce((sum, line) => sum + line.lineTotalUsd, 0)),
    };
  });

  return {
    createdAt: now().toISOString(),
    status: "draft",
    budgetUsd: summary.budgetUsd,
    totalUsd: summary.subtotalUsd,
    remainingUsd: summary.remainingUsd,
    budgetStatus: summary.status,
    groups,
    unpricedItemCount: summary.unpricedItemIds.length,
    swapsApplied: [...swapsApplied],
    savedUsd: roundUsd(swapsApplied.reduce((sum, swap) => sum + swap.savingsUsd, 0)),
  };
}

export function approvePlan(plan: ShoppingPlan): ShoppingPlan {
  return { ...plan, status: "approved" };
}

/** Plain-text version for a "Copy plan" button or a pitch slide. */
export function planToText(plan: ShoppingPlan): string {
  const lines: string[] = [
    `DreamGrid shopping plan (${plan.status})`,
    `Budget ${formatUsd(plan.budgetUsd)} | Total ${formatUsd(plan.totalUsd)} | Remaining ${formatUsd(plan.remainingUsd)}`,
  ];
  if (plan.savedUsd > 0) {
    lines.push(`Saved ${formatUsd(plan.savedUsd)} with ${plan.swapsApplied.length} swap(s)`);
  }
  for (const group of plan.groups) {
    lines.push("", `${group.merchant} - ${formatUsd(group.subtotalUsd)}`);
    for (const line of group.lines) {
      const qty = line.quantity > 1 ? ` x${line.quantity}` : "";
      lines.push(`- ${line.product.title}${qty}: ${formatUsd(line.lineTotalUsd)} ${line.product.sourceUrl}`);
    }
  }
  if (plan.unpricedItemCount > 0) {
    lines.push("", `${plan.unpricedItemCount} item(s) without a price are not included.`);
  }
  lines.push("", "Nothing is purchased through DreamGrid.");
  return lines.join("\n");
}
