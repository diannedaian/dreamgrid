# Linda: Budget, Shopping Plan, and Product Sourcing Plan

Status: Working plan for Linda's lane (commerce). Supplements, does not replace,
`PROJECT_MANIFESTO.md` and `TEAM_HANDOFF.md`.
Owner: Linda
Last updated: 2026-09-19

## Decisions already made

- **No Visa / no payment provider.** DreamGrid cannot consolidate purchases
  across Amazon, IKEA, etc. "Approve" means *lock in a shopping plan with
  per-merchant links*, not pay. This satisfies the manifesto's "explicitly
  labeled fallback" clause (`PROJECT_MANIFESTO.md` §7). The `CommerceGateway`
  boundary in `services/api/.../boundaries/commerce.py` stays as documentation;
  no checkout route is built.
- **One source of truth for items.** Totals are derived from
  `RoomState.items` (Cindy's state) joined to `Product[]`. There is no separate
  cart. Nothing in `commerce/` holds cart state in `useState`.
- **Contracts stay locked.** No changes to `@dreamgrid/contracts`. Anything
  scraped or searched arrives as a `ProductDraft` (API-side type) and becomes a
  real `Product` only after the user confirms and `validateProduct` passes.
- **Product sourcing (URL import + budget-aware search) is Linda's**, built
  after the budget core, and after the team agrees to promote it into scope
  (manifesto §10 lists scraping/search as post-MVP non-goals until rehearsed).
  Cindy owns the catalog rendering and may absorb/restyle the import form.
- **UI stays unstyled.** Plain markup with `className` hooks; a shared theme
  will be applied later.

## Tooling on Linda's machine (Windows)

Helper scripts assume `.venv/bin/python` and bash; do the equivalent by hand.

```powershell
corepack enable; corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
python -m venv .venv
.venv\Scripts\python.exe -m pip install --upgrade pip
.venv\Scripts\python.exe -m pip install -c services/api/constraints-dev.txt -e "services/api[dev]"
```

Run servers in two terminals:

```powershell
pnpm --filter @dreamgrid/web dev
# and, from services/api:
..\..\.venv\Scripts\python.exe -m uvicorn dreamgrid_api.main:app --app-dir src --reload --port 8000
```

Checks (equivalent of `pnpm check`):

```powershell
pnpm -r --if-present lint; pnpm -r --if-present typecheck; pnpm -r --if-present test; pnpm -r --if-present build
.venv\Scripts\python.exe -m ruff check services/api
.venv\Scripts\python.exe -m mypy --config-file services/api/pyproject.toml services/api/src
.venv\Scripts\python.exe -m pytest services/api/tests
```

Gotchas:

- Repo is under OneDrive; prefer a clone outside OneDrive or exclude
  `node_modules` from sync.
- ESLint runs with `--max-warnings=0` and `react-refresh/only-export-components`:
  pure logic in `.ts`, components in `.tsx`, a `.tsx` exports only components.
- If pip fails on Python 3.13, use 3.11/3.12 (CI uses 3.11).
- Fixtures load in tests via `readFile(new URL("../../../../fixtures/", import.meta.url))`
  (see `packages/contracts/test/contracts.test.ts`).

## Architecture

```
RoomState.items + Product[]
        |
        v
 summarizeBudget()   -> BudgetPanel        (subtotal / remaining / under-over)
        |
        v
 rankAlternatives()  -> AlternativesList   (cheaper same-category swaps)
        |  applySwap() -> new RoomState -> back to app state / Cindy's scene
        v
 buildShoppingPlan() -> PlanSummary + ApprovalScreen (per-merchant links, savings)

Product sourcing (later):
 paste URL -> POST /api/v1/products/import -> ProductDraft -> confirm form -> Product
 "desk 120x60 <= $43" -> POST /api/v1/products/search -> ranked drafts -> confirm -> Product
 New Product -> app product list -> Cindy's catalog, Linda's budget, Dianne's generator
```

Files:

```
apps/web/src/commerce/
  budget.ts / budget.test.ts               Step 1
  alternatives.ts / alternatives.test.ts   Step 2
  shoppingPlan.ts / shoppingPlan.test.ts   Step 3
  BudgetPanel.tsx  AlternativesList.tsx  PlanSummary.tsx  ApprovalScreen.tsx   Step 4
  CommerceDemo.tsx                         Step 4 (standalone harness)
  units.ts / units.test.ts                 Step 6
  ImportProductForm.tsx                    Step 6
  ProductSearchForm.tsx                    Step 9
  README.md                                Step 5 (handoff)
apps/web/src/lib/commerce/
  importProductFromUrl.ts                  Step 7
  searchProducts.ts                        Step 9
services/api/src/dreamgrid_api/
  boundaries/product_sourcing.py           Step 7
  adapters/commerce/html_product_scraper.py   Step 7
  adapters/commerce/llm_product_extractor.py  Step 8
  adapters/commerce/search_provider.py        Step 9
  adapters/commerce/fixture_sourcing.py       Step 9
  api/v1/routes/products.py                Step 7, 9
```

## Steps

### Step 0: Environment

Follow the tooling section. Verify `http://localhost:5173` shows the purple
cube and "API connected", and `http://localhost:8000/docs` lists
`/api/v1/health`. Run the web tests once to confirm vitest works.

### Step 1: Budget engine (branch `linda/budget-engine`, T+1 to T+3)

`budget.ts`:

```ts
type BudgetLine = { sceneItemId: string; product: Product };
type BudgetStatus = "under" | "at-limit" | "over";
type BudgetSummary = {
  lines: BudgetLine[]; unpricedItemIds: string[];
  subtotalUsd: number; budgetUsd: number; remainingUsd: number; status: BudgetStatus;
};
roundUsd(n): number                       // Math.round(n * 100) / 100
summarizeBudget(state: RoomState, products: Product[]): BudgetSummary
```

Rules: one line per scene item (duplicates count each time); unknown
`productId` goes to `unpricedItemIds` and never throws; asset status is
irrelevant to price.

Tests against fixtures: `room-state.json` -> 407 / 43 / under; empty room ->
0 / under; + `product-lamp-floor` -> 469 / -19 / over; unknown product ->
one unpriced, subtotal unchanged; same product twice -> counted twice.

Open a draft PR immediately. This is the T+4 milestone deliverable.

### Step 2: Alternatives (same branch or `linda/alternatives`)

`alternatives.ts`:

```ts
type Alternative = { sceneItemId; from: Product; to: Product; savingsUsd; score; reasons: string[] };
rankAlternatives(state, products): Alternative[]
applySwap(state, alt): RoomState          // new state; same item id/position/rotation
fitToBudget(state, products): { state: RoomState; swaps: Alternative[] }
scoreProductFit(target, candidate)        // shared with Step 9 ranking
```

Candidates: same `category`, strictly lower `priceUsd`.
Score = 0.45 savings% + 0.25 style/color tag overlap (Jaccard, colors at half
weight) + 0.30 footprint fit (penalize candidate wider/deeper than current).
`fitToBudget`: greedy best swap, recompute, repeat until not over; one swap
per scene item max. Swapped product with no `modelAssetId` -> `""` and flag
to Cindy.

Tests: arc lamp -> mushroom lamp (save 17); cube shelf -> rolling cart
(save 40); bed -> empty array; `fitToBudget` on over-budget fixture ends under.

### Step 3: Shopping plan (same branch)

`shoppingPlan.ts`:

```ts
type PlanLine = { product: Product; quantity: number; lineTotalUsd: number };
type MerchantGroup = { merchant: string; lines: PlanLine[]; subtotalUsd: number };
type ShoppingPlan = {
  createdAt; budgetUsd; totalUsd; remainingUsd; groups: MerchantGroup[];
  swapsApplied: Alternative[]; savedUsd: number; status: "draft" | "approved";
};
buildShoppingPlan(state, products, swapsApplied): ShoppingPlan
approvePlan(plan): ShoppingPlan
planToText(plan): string                  // "Copy plan" button
```

Group by merchant; each line links to `sourceUrl`. `savedUsd` is the
Ramp/impact metric.

Tests: fixture -> one merchant group, 3 lines, total 407; two beds ->
quantity 2; swaps flow into `savedUsd`.

### Step 4: UI (branch `linda/budget-ui`)

All props-only, no cart state, minimal markup.

| Component | Props | Shows |
|---|---|---|
| `BudgetPanel` | `summary`, `onBudgetChange` | budget input, subtotal, remaining, under/over badge, unpriced note |
| `AlternativesList` | `alternatives`, `onApplySwap`, `onFitToBudget` | swap cards with savings + reasons; empty state |
| `PlanSummary` | `plan` | merchant groups with links, totals, savings |
| `ApprovalScreen` | `plan`, `onApprove`, `onBack` | consent copy ("nothing is purchased through DreamGrid"), approve, success state with Copy plan |

`CommerceDemo.tsx`: `useState<RoomState>(fixture)` + add/remove buttons +
all components. Point `main.tsx` at it locally only; never commit that.

Tests: over-budget badge renders; approve click flips to success state.
Screenshot in PR.

### Step 5: Handoff README + integration (T+4 / T+8)

Rewrite `apps/web/src/commerce/README.md` with: inputs the shell must supply
(`roomState`, `products`, `setRoomState`), exported functions, the one-line
wiring (`useMemo(() => summarizeBudget(roomState, products), ...)`),
behavior for unknown products and missing `modelAssetId`, and "approval
creates a plan; no payment provider."

At T+4 integration, the `App.tsx` owner for that session mounts
`BudgetPanel` and wires `onApplySwap` to `setRoomState(applySwap(...))`.

### Step 6: Manual product entry + unit conversion (client only)

`units.ts`: `toMeters(value, unit)`, `parseDimensionString(s)` handling
`47.2"W x 23.6"D x 29.5"H`, `120 x 60 x 75 cm`, `W120 D60 H75`. Tested.
Reused by the scraper in Step 7.

`ImportProductForm.tsx`: title, price, W/H/D + unit, category, optional
image/source URL. Builds a `Product` (`id: "product-import-<uuid>"`,
`merchant` from hostname or "Manual entry"), runs `validateProduct`, calls
`onProductCreated`. Wire into `CommerceDemo`. This is the fallback for
Steps 7 to 9.

### Step 7: URL import scraper + route (backend)

`boundaries/product_sourcing.py`: `ProductDraft` (all optional fields,
`confidence`, `extraction_method`, `missing`), `ProductSourcingGateway`
with `import_from_url(url)`.

`adapters/commerce/html_product_scraper.py` extraction ladder:
1. `httpx` fetch: 8 s timeout, 2 MB cap, browser UA, max 3 redirects.
2. JSON-LD `schema.org/Product` (name, image, offers.price, brand, dims).
3. OpenGraph / meta (`og:title`, `og:image`, `product:price:amount`).
4. Text patterns near "Dimensions"/"Size"/"Measurements".
5. Fill `missing`, set `confidence`.

Safety: http/https only, reject private/loopback IPs (SSRF), only fetch
user-pasted URLs. Add `httpx` + `beautifulsoup4` to `pyproject.toml`
(announce; shared file).

Route `POST /api/v1/products/import` `{ url }` -> camelCase draft. A blocked
or failed fetch returns 200 with a manual-only draft, never 5xx.

Tests: saved HTML pages under `services/api/tests/fixtures/` (IKEA-style
JSON-LD, Shopify-style, no structured data); injected fake fetcher; no
network.

Client: `lib/commerce/importProductFromUrl.ts`; error -> manual draft. URL
box above `ImportProductForm`; "Fetch" prefills the form.

### Step 8: LLM extraction rung (needs `DREAMGRID_OPENAI_API_KEY`)

`adapters/commerce/llm_product_extractor.py`: when dims or price are still
missing, send title + meta + ~6 KB visible text to OpenAI with a structured
output schema matching `ProductDraft`. Last rung of the ladder; skipped when
no key. Mark `extraction_method: "llm"` and disclose in the UI. Test with a
fake client returning canned JSON.

### Step 9: Budget-aware search (needs a search provider key)

Boundary: `ProductQuery { category, keywords, target_dimensions_m,
max_price_usd, style_tags }`, `search(query, limit=8) -> list[ProductDraft]`.

Provider (behind the boundary, pick one): OpenAI web search tool; SerpAPI
Google Shopping; Brave/Tavily + Step 7 importer per result.

Route `POST /api/v1/products/search`. Rank client-side with
`scoreProductFit`: 0.4 price fit + 0.4 dimension fit (1 - mean relative
error) + 0.2 style; over-budget results sorted last, not hidden.

`ProductSearchForm.tsx`: category, keywords, W/H/D + unit, max price
defaulting to `summary.remainingUsd`. Results -> confirm form ->
`onProductCreated`.

Fallback: `fixtures/search-results.json` via `FixtureSourcingGateway`,
selected by `DREAMGRID_PRODUCT_SOURCING=fixture|live`.

### Step 10: Cache, disclosure, rehearsal

In-process cache keyed by URL / query. Surface `extractionMethod` in the UI;
add providers to the repo's API disclosure. Rehearse: working URL, blocked
URL (manual fallback), search with provider off (fixture results).

## Order and dependencies

| Step | Backend | Key | When |
|---|---|---|---|
| 0 | - | - | Before hacking |
| 1-5 | No | No | T+1 to T+8 |
| 6 | No | No | After T+8 or when idle |
| 7 | Yes | No | After team agrees to promote sourcing |
| 8 | Yes | OpenAI | After 7 |
| 9 | Yes | Search | After 8 |
| 10 | Yes | - | Before T+20 demo freeze |

Branch names: `linda/budget-engine`, `linda/alternatives`, `linda/budget-ui`,
`linda/product-import`, `linda/product-search`. Each PR says "fixture" or
"live" per the PR template.

## Teammate interactions

- Both: "Approval = shopping plan with store links, no payment provider.
  Product sourcing comes after the budget core." Update manifesto award list,
  golden-path step 10, and Visa docstrings together.
- Cindy: remove `SceneItem`s on delete (don't flag); swaps return a new
  `RoomState` with same item ids; agree what the loader shows when
  `modelAssetId` is empty; imported products without a price get
  `priceUsd: 0` and are shown as "unpriced"; who renders prices in the
  inventory panel; who owns the import form styling.
- Dianne: imported `Product.imageUrl` + `dimensionsM` feed her generator;
  shared edits to `router.py`, `config.py`, `pyproject.toml` are announced.
- Linda reviews any PR touching prices, cart state, or approval state.

## Design decisions (answered 2026-09-19)

- Q1 Unpriced items: count as $0, list in `unpricedItemIds`, show "N items
  without a price"; approval is still allowed.
- Q2 Fit my budget: swaps only. If swaps cannot get under budget, say so;
  never suggest removing an item.
- Q3 Apply mode: preview first. Each alternative has its own Apply; one
  "Apply all" runs `fitToBudget`. No auto-apply.
- Q4 Workflow: the agent implements on a `linda/*` branch, runs checks, and
  summarizes; Linda reviews.

## Progress log

### 2026-09-19: Steps 0 to 5 done on branch `linda-budget-engine`

Branch is `linda-budget-engine` (hyphen) because a branch named `linda`
already exists and git cannot hold both `linda` and `linda/*`. Delete the
empty `linda` branch to use the workflow doc's slash naming.

Environment (Step 0): pnpm installed with `npm install -g pnpm@11.19.0`
(`corepack enable` needs admin). Run pnpm from PowerShell, not Git Bash (the
Git Bash shim mangles the path). `.venv` created with Python 3.13; API deps
installed and tests pass.

Commits:

1. `feat(budget): calculate subtotal and budget status from scene items` —
   Step 1: `budget.ts`, `budget.test.ts`, README, this plan.
2. `feat(budget): rank cheaper alternatives and build a shopping plan` —
   Steps 2 and 3: `scoring.ts`, `alternatives.ts`, `shoppingPlan.ts`,
   `format.ts`, `testFixtures.ts`, tests.
3. Step 4 and 5 (UI, demo harness, handoff README) — see git log.

What exists in `apps/web/src/commerce/`:

| File | Purpose |
|---|---|
| `budget.ts` | `summarizeBudget`, `roundUsd`, `budgetStatus` |
| `scoring.ts` | `jaccard`, `styleSimilarity`, `sharedTags`, `footprintFit`, `dimensionFit` |
| `alternatives.ts` | `rankAlternatives`, `applySwap`, `fitToBudget`, `PLACEHOLDER_MODEL_ASSET_ID` |
| `shoppingPlan.ts` | `buildShoppingPlan`, `approvePlan`, `planToText` |
| `format.ts` | `formatUsd`, `formatSignedUsd` |
| `BudgetPanel.tsx`, `AlternativesList.tsx`, `PlanSummary.tsx`, `ApprovalScreen.tsx` | Props-only components |
| `CommerceDemo.tsx`, `demoData.ts`, `demo-main.tsx` | Standalone harness; served at `/commerce-demo.html` in dev |
| `testFixtures.ts` | Fixture loader + builders for node-environment tests |
| `README.md` | Handoff: inputs, wiring, exports, Cindy asks |

Tests: 32 in `src/commerce` (pure modules use `// @vitest-environment node`
so `import.meta.url` is a `file:` URL; component tests use the default
jsdom). Lint, typecheck, build, and API pytest all pass.

Decisions made while implementing:

- `modelAssetId` has `minLength: 1` in the schema, so a swap to a product
  without an asset uses `PLACEHOLDER_MODEL_ASSET_ID = "asset-placeholder"`.
  Cindy's loader should map it to the backbone cube.
- `rankAlternatives` returns every candidate (not just the best per item),
  sorted by score; `fitToBudget` picks greedily and skips items it already
  swapped.
- `fitToBudget` on an already affordable room returns the same state object
  and no swaps.
- `apps/web/commerce-demo.html` is a second Vite entry so the demo can be
  viewed without editing the shared `main.tsx`/`App.tsx`. Vite's build only
  bundles `index.html`, so it never ships.
- `demoData.ts` imports the repo fixtures with a type cast; the contracts
  package already validates those files.

Not done / next:

- Not pushed; no PR opened yet. Push and open a draft PR after Linda's
  review.
- `App.tsx` untouched (shared file; wire at the T+4 integration session).
- Step 6 (manual product entry + `units.ts`) is the next item.
- Ask Cindy about `PLACEHOLDER_MODEL_ASSET_ID`, deletion semantics, and who
  renders prices in the inventory panel.
