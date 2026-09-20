# Linda: Budget, Shopping Plan, and Product Sourcing Plan

Status: Working plan for Linda's lane (commerce). Supplements, does not replace,
`PROJECT_MANIFESTO.md` and `TEAM_HANDOFF.md`.
Owner: Linda
Last updated: 2026-09-19

## Integration status (2026-09-19)

Merged into the vanilla-TS room planner from `main`. The React components named
below were ported to plain-DOM modules (the app has no React): the **Budget**
chip under Measure opens `apps/web/src/commerce/budgetBar.ts` (budget, cheaper
swaps, shopping plan + approval); the ⌕ Shop drawer (`apps/web/src/catalog/shopBar.ts`)
runs search and pasted links through `productSourcing.ts` → `services/api`, and
"+ Add your own product" opens `productForm.ts`. Products join the catalog via
`catalogAdd.ts` (localStorage + Cindy's importer for a 3D model). Pure modules
and tests are unchanged. See `apps/web/HANDOFF.md` and `apps/web/src/commerce/README.md`.

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

Review feedback applied (same day): the fit message went stale after a
budget change, and there was no way back after a swap. Added `revertSwaps`
plus an "applied swaps" section with a "Swap everything back" button in
`AlternativesList`; `CommerceDemo` clears the fit message on any room edit.
The compositor must do the same: keep `swapsApplied` next to `roomState` and
reset the message whenever it sets the room outside the fit flow.

### 2026-09-19 (later): Steps 6 to 10 done on the same branch

Commits (after the Step 1 to 5 ones):

5. `feat(commerce): add manual product entry with unit parsing and API adapter`
   — Step 6: `units.ts`, `draftToProduct.ts`, `ImportProductForm.tsx`,
   `src/lib/commerce/productSourcing.ts` (+ tests).
6. `feat(api): add product sourcing (URL import, OpenAI extraction, search)`
   — Steps 7, 8, 9 backend: `boundaries/product_sourcing.py`,
   `adapters/commerce/{page_fetcher,html_product_parser,openai_client,
   llm_product_extractor,search_provider,product_sourcing_service}.py`,
   `routes/products.py`, `fixtures/search-results.json`, settings, tests.
7. Step 9 UI + Step 10 docs — `productSearch.ts`, `ProductSearchForm.tsx`,
   demo wiring, READMEs (see git log).

Verified against real stores with the API running (fixture mode, no key):

| Store | Result |
|---|---|
| burrow.com (Shopify) | title, price, image from JSON-LD; dimensions missing (LLM rung would fill) |
| ikea.com | HTTP 200 JavaScript shell; title only → reported as manual with a note |
| wayfair.com | HTTP 429 (bot protection) → manual draft with the HTTP code in the note |
| target.com | JavaScript shell → manual |
| `http://127.0.0.1/...` | refused by the SSRF guard |

Test counts: web 78 (69 in commerce + lib/commerce), contracts 8, API 39.
ruff, mypy strict, eslint, tsc, and the Vite build pass.

Decisions made while implementing Steps 6 to 10:

- **Stdlib HTML parser, no BeautifulSoup**: avoids a new dependency and a
  `constraints-dev.txt` refresh. `httpx` moved from dev-only to runtime
  dependency (already pinned).
- **No OpenAI SDK**: `openai_client.py` is a ~100-line httpx wrapper around
  the Responses API with `text.format = json_schema` (strict). Swap in the SDK
  later if wanted; the `TextModel` protocol is the seam.
- **LLM rung only fills missing fields**; structured data is never
  overwritten. Output is capped at confidence 0.7 and labeled `llm`.
- **Search ranking is client-side** (`rankSearchResults`) so there is one
  implementation of the price/size/style weights, shared with alternatives via
  `scoring.ts`.
- **Title-only pages count as "manual"**: a `<title>` alone is what bot walls
  and JS shells return; calling that "structured data" misled the form.
- **`step="any"` on number inputs**: `step="0.1"` made browsers refuse to
  submit values like 47.24 in (found by the jsdom test).
- **`build_product_sourcing` uses `parents[6]`** to reach `<repo>/fixtures`;
  `DREAMGRID_FIXTURES_DIR` overrides it for deployments.

Not done / open:

- Nothing is pushed; no PR yet.
- `App.tsx` still untouched; `CommerceDemo.tsx` shows the full wiring.
- Live OpenAI paths (extraction and web search) are exercised only by fakes.
  First run with a real key: set `DREAMGRID_PRODUCT_SOURCING=live`, paste the
  Burrow URL above, and confirm dimensions arrive labeled "AI".
- `/demo-assets/previews/placeholder.webp` (used as the image for hand-entered
  products and fixture search results) does not exist yet; Dianne's asset PR
  should add a small placeholder image.

### 2026-09-19 (evening): blocked-store fallbacks, live OpenAI verified

Linda put `OPENAI_KEY` in the repo-root `.env` (git-ignored). Changes:

- `config.py`: also loads the repo-root `.env`; accepts
  `DREAMGRID_OPENAI_API_KEY` / `OPENAI_API_KEY` / `OPENAI_KEY`;
  `product_sourcing` defaults to `auto` (live iff a key exists).
- `adapters/commerce/url_lookup.py` (`OpenAIUrlLookup`): when a fetch is
  blocked (4xx/5xx, timeout) or the page is a JavaScript shell, ask the model
  with `web_search` to identify the exact listing from the URL. Labeled `llm`
  with a "store blocked direct reading" note; `NullUrlLookup` without a key.
- `productText.ts` + a textarea in `ImportProductForm`: paste the store's
  product-details block; price/dimensions/title/category are parsed in the
  browser. Works for every store, no key needed.
- Search prompt now restricts to US retailers and USD prices (the first live
  run returned Swiss/UK/Australian stores).

Live results with the real key (API in auto mode):

| Call | Time | Result |
|---|---|---|
| search desk ≤ $60, 100×75×50 cm | 6 s | 4 real listings with dims; first run non-US, fixed by prompt |
| import amazon.com/dp/B0BW8S1N3C (IKEA MICKE) | 4 s | fetch blocked → lookup: title, 1.05×0.75×0.5 m, category desk; price not verified → user fills |

Test counts: web 86, contracts 8, API 44. All checks pass.

Cost/latency note: each live search or lookup is one Responses API call with
web search, roughly 4 to 8 s. Results are cached per URL/query in the API
process, so rehearsing the same demo inputs is free after the first run.

### 2026-09-19 (night): SerpAPI Google Shopping replaces OpenAI as the search engine

OpenAI web search as a product search engine was slow (12-18 s) and noisy
even after the citation fix (an Austrian IKEA page, a Best Buy reviews page,
spray paint for "small lamp"). Added `serpapi_search_provider.py`: one GET to
SerpAPI's `google_shopping` engine, ~14 s on this network, real listings with
prices, merchants, and thumbnails. `SERPAPI_KEY` in the repo-root `.env`.

Backend selection (`DREAMGRID_PRODUCT_SEARCH=auto`): SerpAPI if keyed, else
OpenAI web search if keyed, else fixture. The OpenAI URL lookup and
extraction rung are unchanged and still fill dimensions when a result is
picked and its link is read.

Findings: Google ignores the `tbs` price filter, so the limit goes into the
query text ("small desk under $43") and results are ordered within-budget
first; several sellers list one catalog item, so results are deduped by
catalog id; links are Google Shopping product pages (`www.google.com/...`)
because SerpAPI's basic results rarely include the merchant URL; the
merchant's own page is one click further.

Live check: "small desk under $43" -> 6 desks $25.99-$39.89 from Walmart,
eBay, Home Depot. "lamp under $30" -> 5 lamps $12.99-$20.99.

Open: the API process the user started in their own terminal keeps running
old code; restart it after pulling. Tests: API 61, web 87.
