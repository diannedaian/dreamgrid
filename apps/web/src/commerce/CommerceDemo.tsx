import type { Product, RoomState, SceneItem } from "@dreamgrid/contracts";
import { useMemo, useState } from "react";

import type { ProductDraft } from "../lib/commerce/productSourcing";
import { AlternativesList } from "./AlternativesList";
import { ApprovalScreen } from "./ApprovalScreen";
import { BudgetPanel } from "./BudgetPanel";
import { ImportProductForm } from "./ImportProductForm";
import { ProductSearchForm } from "./ProductSearchForm";
import {
  PLACEHOLDER_MODEL_ASSET_ID,
  applySwap,
  fitToBudget,
  rankAlternatives,
  revertSwaps,
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
  products: initialProducts = demoProducts,
}: CommerceDemoProps) {
  const [roomState, setRoomState] = useState<RoomState>(initialRoomState);
  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [pickedDraft, setPickedDraft] = useState<ProductDraft>();
  const [swapsApplied, setSwapsApplied] = useState<Alternative[]>([]);
  const [fitMessage, setFitMessage] = useState<string>();
  const [plan, setPlan] = useState<ShoppingPlan>();

  const summary = useMemo(() => summarizeBudget(roomState, products), [roomState, products]);
  const alternatives = useMemo(() => rankAlternatives(roomState, products), [roomState, products]);

  /** Any room edit outside the fit flow makes the last fit message stale. */
  function changeRoom(next: RoomState) {
    setRoomState(next);
    setFitMessage(undefined);
  }

  function addProduct(product: Product) {
    const item: SceneItem = {
      id: `scene-${product.id}-${roomState.items.length + 1}`,
      productId: product.id,
      modelAssetId: product.modelAssetId ?? PLACEHOLDER_MODEL_ASSET_ID,
      positionM: [0, 0, 0],
      rotationYDeg: 0,
    };
    changeRoom({ ...roomState, items: [...roomState.items, item] });
  }

  function removeItem(sceneItemId: string) {
    changeRoom({ ...roomState, items: roomState.items.filter((i) => i.id !== sceneItemId) });
  }

  function handleApplySwap(alternative: Alternative) {
    changeRoom(applySwap(roomState, alternative));
    setSwapsApplied([...swapsApplied, alternative]);
  }

  function handleUndoSwaps() {
    changeRoom(revertSwaps(roomState, swapsApplied));
    setSwapsApplied([]);
  }

  /** A sourced product joins the catalog; the user adds it to the room like any other. */
  function handleProductCreated(product: Product) {
    setProducts([...products, product]);
    setPickedDraft(undefined);
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

      <ImportProductForm draft={pickedDraft} onProductCreated={handleProductCreated} />
      <ProductSearchForm
        defaultMaxPriceUsd={summary.remainingUsd}
        onPickResult={setPickedDraft}
      />

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
        onBudgetChange={(budgetUsd) => changeRoom({ ...roomState, budgetUsd })}
      />

      <AlternativesList
        alternatives={alternatives}
        isOverBudget={summary.status === "over"}
        onApplySwap={handleApplySwap}
        onFitToBudget={handleFitToBudget}
        fitMessage={fitMessage}
        appliedSwaps={swapsApplied}
        onUndoSwaps={handleUndoSwaps}
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
