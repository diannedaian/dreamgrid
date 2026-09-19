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

## Product sourcing (paste a link, or search by size and budget)

`ImportProductForm` and `ProductSearchForm` create new `Product`s. Both go
through `src/lib/commerce/productSourcing.ts`, which never throws: with the
API down, import yields a manual draft and search yields an empty offline
result, so the manual form always works.

- `units.ts` — `toMeters`, `fromMeters`, `parseDimensionString` (handles
  `47.2"W x 23.6"D x 29.5"H`, `120 x 60 x 75 cm`, `W 120cm x D 60cm x H 75cm`).
  User units are converted to meters here, at the input boundary.
- `draftToProduct.ts` — `fieldsFromDraft`, `validateFields`, `buildProduct`
  (runs `validateProduct` from the contracts package; a bad product never
  reaches the catalog). `priceUsd: 0` means "unpriced".
- `productSearch.ts` — `rankSearchResults(query, drafts)`: 0.4 price fit +
  0.4 size fit + 0.2 style. Over-limit results sort last but are never hidden.
- `productText.ts` — `parseProductText(text, unit)`: reads a pasted
  "Product information" block (Amazon, IKEA, any store) in the browser:
  selling price (ignores list price / savings), `W x D x H` dimensions with
  their unit, a title, and a category guess. This is the path that always
  works, even for stores that block the API's reader.
- `ImportProductForm` props: `onProductCreated`, `draft?` (prefill),
  `fetchDraft?` (test injection). Three ways in: read a link, paste the
  details, or type them. Shows how each field was obtained (structured data /
  page text / AI / fixture / by hand).
- `ProductSearchForm` props: `defaultMaxPriceUsd` (pass
  `summary.remainingUsd`), `onPickResult` (hand the draft to the import form),
  `search?` (test injection).

API contract (see `services/api/.../routes/products.py`): `POST
/api/v1/products/import { url }` and `POST /api/v1/products/search
{ category, keywords?, targetDimensionsM?, maxPriceUsd?, styleTags?, limit? }`.
Both return camelCase `ProductDraft`s, never `Product`s. Without an OpenAI
key, search reads `fixtures/search-results.json` and import reads only what
the page itself states. With a key (`OPENAI_KEY` in the repo-root `.env` is
enough), import falls back to an AI web-search lookup when a store blocks
direct reading (Amazon, IKEA, Wayfair, Target), the AI fills dimensions the
page did not state, and search returns live US listings.

**Ownership note:** the manifesto gives the import-product UI to Cindy. These
two forms live here so the sourcing pipeline could be built end to end; Cindy
may move or restyle them. A new `Product` should be appended to the app's
product list so the catalog, the budget, and the generator all see it.

## Approval

Approval produces a shopping plan (per-merchant lines with `sourceUrl` links
and savings). No payment provider is called and nothing is purchased through
DreamGrid.

## Fixture check

`fixtures/room-state.json` + `fixtures/products.json`: subtotal 407,
remaining 43, `under`. Adding `product-lamp-floor` goes to 469 / -19 /
`over`; "Make this room fit my budget" swaps it to the mushroom lamp.
