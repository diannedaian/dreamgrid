# Commerce ownership: Linda

Budget, subtotal, cheaper-alternative, and shopping-plan approval logic and
UI live here. Everything consumes the shared `RoomState` and `Product[]`;
nothing in this directory keeps its own cart.

Do not implement 3D manipulation or model generation here. The step-by-step
plan is in `docs/LINDA_COMMERCE_PLAN.md`.

## Where it shows up in the app

The web app is vanilla TypeScript (no React), so the UI here is plain DOM:

| Module | Mounted from `main.ts` as | What it is |
|---|---|---|
| `budgetBar.ts` | the **Budget** chip under Measure → `#budgetbar` drawer | budget input, room total / remaining, cheaper swaps, "fit my budget", shopping plan + approval |
| `productForm.ts` | "+ Add your own product" in the ⌕ Shop drawer | read a link / paste listing text / type a product |
| `catalogAdd.ts` | `createCatalogAdder` | Product → catalog + `localStorage` (`savedProducts.ts`) → Cindy's importer for a 3D model |
| `../catalog/shopBar.ts` | ⌕ (top right) | search / pasted link through `productSourcing.ts`, ranked by `productSearch.ts` |

`RoomState` is built on the fly: `{ room, budgetUsd, items: placement.items }`
with `products = catalog.entries().map(e => e.product)`. The budget number lives
in the plan URL (`b`), so shared links carry it. Swaps go back into the room via
`placement.remove(id)` + `placement.add(product, asset, position, rotation, id)`.

Because everything is derived from the placed items, totals follow every add,
move, rotate, swap, or delete; `main.ts` calls `budget.refresh()` from the
placement `onChange` and on catalog changes.

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

## UI modules (plain DOM; styles live in `index.html` under `.drawer`)

| Module | Options |
|---|---|
| `mountBudgetBar(bar, chip, o)` | `room`, `catalog`, `items()`, `budgetUsd`, `onBudgetChange`, `swap(itemId, product)`, `copyText`, `onOpen?` → `{ refresh, setOpen, budgetUsd, summary }` |
| `mountProductForm(root, o)` | `onProductCreated`, `fetchDraft?`, `productId?` → `{ open(draft?), close, toggle, isOpen }` |
| `createCatalogAdder(o)` | `catalog`, `importModel?`, `save?` → `{ add(product) → { product, model: Promise<ModelOutcome> } }` |

The former React components (`BudgetPanel`, `AlternativesList`,
`ApprovalScreen`, `ImportProductForm`, `ProductSearchForm`, `CommerceDemo`)
were ported into these; the pure modules and their tests are unchanged.

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
- `productForm.ts` (the "Add your own product" form): three ways in — read a
  link, paste the details, or type them. Shows how each field was obtained
  (structured data / page text / AI / fixture / by hand).
- `shopBar.ts` search: the price limit defaults to `summary.remainingUsd`;
  "Add to catalog" reads the link first when the listing lacks dimensions and
  opens the form prefilled when something (usually the price) is still missing.
- `productSourcing.ts` turns the API's `null` fields into `undefined` so
  `mergeDrafts` and the form see them as missing.

API contract (see `services/api/.../routes/products.py`): `POST
/api/v1/products/import { url }` and `POST /api/v1/products/search
{ category, keywords?, targetDimensionsM?, maxPriceUsd?, styleTags?, limit? }`.
Both return camelCase `ProductDraft`s, never `Product`s. Without an OpenAI
key, search reads `fixtures/search-results.json` and import reads only what
the page itself states. With a key (`OPENAI_KEY` in the repo-root `.env` is
enough), import falls back to an AI web-search lookup when a store blocks
direct reading (Amazon, IKEA, Wayfair, Target), the AI fills dimensions the
page did not state, and search returns live US listings.

**Ownership note:** the manifesto gives the import-product UI to Cindy. The
form lives here so the sourcing pipeline could be built end to end; Cindy may
move or restyle it. A new `Product` goes through `catalogAdd.ts`, so the
catalog, the budget, and Cindy's model generator all see it (its id matches
the importer's `imp-<sha1(url)[:16]>` so the same page is never listed twice).

## Approval

Approval produces a shopping plan (per-merchant lines with `sourceUrl` links
and savings). No payment provider is called and nothing is purchased through
DreamGrid.

## Fixture check

`fixtures/room-state.json` + `fixtures/products.json`: subtotal 407,
remaining 43, `under`. Adding `product-lamp-floor` goes to 469 / -19 /
`over`; "Make this room fit my budget" swaps it to the mushroom lamp.
