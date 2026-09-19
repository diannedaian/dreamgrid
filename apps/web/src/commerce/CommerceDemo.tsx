import type { Product, RoomState, SceneItem } from "@dreamgrid/contracts";
import { useMemo, useState } from "react";

import { AlternativesList } from "./AlternativesList";
import { ApprovalScreen } from "./ApprovalScreen";
import { BudgetPanel } from "./BudgetPanel";
import {
  PLACEHOLDER_MODEL_ASSET_ID,
  applySwap,
  fitToBudget,
  rankAlternatives,
  type Alternative,
} from "./alternatives";
import { summarizeBudget } from "./budget";
import { demoProducts, demoRoomState } from "./demoData";
import { formatSignedUsd } from "./format";
import { approvePlan, buildShoppingPlan, type ShoppingPlan } from "./shoppingPlan";

export type CommerceDemoProps = {
  initialRoomState?: RoomState;
  products?: Product[];
};

/**
 * Standalone harness for the commerce lane. It owns one RoomState the way the
 * app compositor will, so the same wiring can be lifted into App.tsx at
 * integration. Add/remove buttons stand in for Cindy's placement layer.
 */
export function CommerceDemo({
  initialRoomState = demoRoomState,
  products = demoProducts,
}: CommerceDemoProps) {
  const [roomState, setRoomState] = useState<RoomState>(initialRoomState);
  const [swapsApplied, setSwapsApplied] = useState<Alternative[]>([]);
  const [fitMessage, setFitMessage] = useState<string>();
  const [plan, setPlan] = useState<ShoppingPlan>();

  const summary = useMemo(() => summarizeBudget(roomState, products), [roomState, products]);
  const alternatives = useMemo(() => rankAlternatives(roomState, products), [roomState, products]);

  function addProduct(product: Product) {
    const item: SceneItem = {
      id: `scene-${product.id}-${roomState.items.length + 1}`,
      productId: product.id,
      modelAssetId: product.modelAssetId ?? PLACEHOLDER_MODEL_ASSET_ID,
      positionM: [0, 0, 0],
      rotationYDeg: 0,
    };
    setRoomState({ ...roomState, items: [...roomState.items, item] });
  }

  function removeItem(sceneItemId: string) {
    setRoomState({ ...roomState, items: roomState.items.filter((i) => i.id !== sceneItemId) });
  }

  function handleApplySwap(alternative: Alternative) {
    setRoomState(applySwap(roomState, alternative));
    setSwapsApplied([...swapsApplied, alternative]);
    setFitMessage(undefined);
  }

  function handleFitToBudget() {
    const result = fitToBudget(roomState, products);
    setRoomState(result.state);
    setSwapsApplied([...swapsApplied, ...result.swaps]);
    setFitMessage(
      result.fitsBudget
        ? `Applied ${result.swaps.length} swap(s); ${formatSignedUsd(result.remainingUsd)} remaining.`
        : `Applied ${result.swaps.length} swap(s) but the room is still ${formatSignedUsd(result.remainingUsd)}; no more cheaper options.`,
    );
  }

  if (plan) {
    return (
      <ApprovalScreen
        plan={plan}
        onApprove={() => setPlan(approvePlan(plan))}
        onBack={() => setPlan(undefined)}
      />
    );
  }

  return (
    <div className="commerce-demo">
      <section className="commerce-demo__catalog" aria-labelledby="commerce-demo-catalog-title">
        <h2 id="commerce-demo-catalog-title">Catalog (demo stand-in)</h2>
        <ul>
          {products.map((product) => (
            <li key={product.id}>
              {product.title} — {product.category}{" "}
              <button type="button" onClick={() => addProduct(product)}>
                Add {product.title}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="commerce-demo__items" aria-labelledby="commerce-demo-items-title">
        <h2 id="commerce-demo-items-title">Placed items</h2>
        <ul>
          {roomState.items.map((item) => (
            <li key={item.id}>
              {products.find((p) => p.id === item.productId)?.title ?? item.productId}{" "}
              <button type="button" onClick={() => removeItem(item.id)}>
                Remove {item.id}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <BudgetPanel
        summary={summary}
        onBudgetChange={(budgetUsd) => setRoomState({ ...roomState, budgetUsd })}
      />

      <AlternativesList
        alternatives={alternatives}
        isOverBudget={summary.status === "over"}
        onApplySwap={handleApplySwap}
        onFitToBudget={handleFitToBudget}
        fitMessage={fitMessage}
      />

      <button
        type="button"
        className="commerce-demo__review"
        onClick={() => setPlan(buildShoppingPlan(roomState, products, swapsApplied))}
      >
        Review shopping plan
      </button>
    </div>
  );
}
