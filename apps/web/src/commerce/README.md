# Commerce ownership: Linda

Budget, subtotal, cheaper-alternative, and shopping-plan approval logic and
UI live here. Everything consumes the shared `RoomState` and `Product[]`;
nothing in this directory keeps its own cart.

Do not implement 3D manipulation or model generation here. The step-by-step
plan is in `docs/LINDA_COMMERCE_PLAN.md`.

## Try it without the rest of the app

```powershell
pnpm --filter @dreamgrid/web dev
```

Open `http://localhost:5173/commerce-demo.html`. `CommerceDemo` holds one
`RoomState` (the fixture room) with add/remove buttons standing in for the
placement layer. It is a dev-only entry; `pnpm build` ignores it.

## Inputs the app shell must supply

| Input | Type | Source |
|---|---|---|
| `roomState` | `RoomState` from `@dreamgrid/contracts` | The one shared state Cindy's placement layer edits |
| `setRoomState` | `(next: RoomState) => void` | Same owner; swaps come back through it |
| `products` | `Product[]` | Catalog (fixture `fixtures/products.json` until live) |

Wiring in the compositor (see `CommerceDemo.tsx` for the full example):

```tsx
const summary = useMemo(() => summarizeBudget(roomState, products), [roomState, products]);
const alternatives = useMemo(() => rankAlternatives(roomState, products), [roomState, products]);

<BudgetPanel summary={summary} onBudgetChange={(budgetUsd) => setRoomState({ ...roomState, budgetUsd })} />
<AlternativesList
  alternatives={alternatives}
  isOverBudget={summary.status === "over"}
  onApplySwap={(alt) => setRoomState(applySwap(roomState, alt))}
  onFitToBudget={() => setRoomState(fitToBudget(roomState, products).state)}
/>
```

Because everything is derived from `roomState`, totals follow every add,
move, rotate, swap, or delete with no events to subscribe to.

## Pure modules (all tested against the shared fixtures)

`budget.ts`

- `summarizeBudget(state, products): BudgetSummary` — one `BudgetLine` per
  scene item (duplicates count twice); unknown `productId` counts as $0 and
  is listed in `unpricedItemIds`; never throws. `status` is `"under"`,
  `"at-limit"`, or `"over"`. Model asset status is irrelevant to price.
- `roundUsd`, `budgetStatus`.

`alternatives.ts`

- `rankAlternatives(state, products): Alternative[]` — every cheaper,
  same-category replacement for every placed item, best first. Score =
  0.45 savings ratio + 0.25 style/color tag overlap + 0.30 footprint fit.
- `applySwap(state, alt): RoomState` — new state; same item `id`,
  `positionM`, `rotationYDeg`; new `productId` and `modelAssetId`.
- `fitToBudget(state, products): { state, swaps, fitsBudget, remainingUsd }`
  — greedy best swap until not over budget; one swap per item; never removes
  anything, so `fitsBudget` can be `false`.
- `revertSwaps(state, swaps): RoomState` — puts the original products back
  for applied swaps; skips items the user removed or changed since.
- `PLACEHOLDER_MODEL_ASSET_ID` — used when the cheaper product has no
  `modelAssetId` (the contract forbids an empty string). **Cindy:** the
  loader should render the backbone cube for this id.

`shoppingPlan.ts`

- `buildShoppingPlan(state, products, swapsApplied)` — per-merchant groups,
  quantities, totals, `savedUsd` from swaps, `unpricedItemCount`.
- `approvePlan(plan)`, `planToText(plan)`.

`scoring.ts` — `jaccard`, `styleSimilarity`, `footprintFit`, `dimensionFit`
(the last is for product search later).

## Components (props only, no cart state, unstyled)

| Component | Props |
|---|---|
| `BudgetPanel` | `summary`, `onBudgetChange?` |
| `AlternativesList` | `alternatives`, `isOverBudget`, `onApplySwap`, `onFitToBudget`, `fitMessage?`, `appliedSwaps?`, `onUndoSwaps?` |
| `PlanSummary` | `plan` |
| `ApprovalScreen` | `plan`, `onApprove`, `onBack` |

Class names (`commerce-budget`, `commerce-alternatives`, `commerce-plan`,
`commerce-approval`, and their `__element` / `--status` variants) are the
styling hooks; no CSS ships from this directory.

## Approval

Approval produces a shopping plan (per-merchant lines with `sourceUrl` links
and savings). No payment provider is called and nothing is purchased through
DreamGrid.

## Fixture check

`fixtures/room-state.json` + `fixtures/products.json`: subtotal 407,
remaining 43, `under`. Adding `product-lamp-floor` goes to 469 / -19 /
`over`; "Make this room fit my budget" swaps it to the mushroom lamp.
