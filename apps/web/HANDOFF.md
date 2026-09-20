# DreamGrid web app — handoff for agents

This is Cindy's subsystem (catalog UI + in-room interaction) plus the placeholder room shell. Read this
before changing anything under `apps/web`. The canonical contracts and ownership rules are in
`docs/PROJECT_MANIFESTO.md`; the branching/PR rules are in `docs/GITHUB_WORKFLOW.md`.

## Run and verify

```sh
cd apps/web
npm install
npm run dev        # https://localhost:5173 (self-signed cert; click through once). Needed for phone sensors.
npm run dev:http   # plain http if you don't need the phone flow
npm test           # vitest, 27 unit tests (units, wall grid, doors, share plan, sun)
npm run build      # typecheck + production build
```

Vanilla TypeScript + three.js + Vite. No framework. The dev server also hosts two tiny endpoints from
`vite.config.ts`: `POST/GET /api/measurement` (phone → desktop relay) and `GET /api/phone-link`.

Quick smoke test in a browser: open `/?w=144&d=120&h=96`, drag "College bed" from the bottom bar
onto the floor, click a wall → Add window → click two inch squares, move the Sun slider, click Share.

## Layout of the code

```
src/main.ts                 wiring: renderer, composer (bloom), room shell, sidebar, placement, share, phone relay
src/room/buildRoom.ts       RoomShell: floor, two walls with holes, grid, lights, sun aiming, paint, floor, view
src/room/sun.ts             time-of-day slider model (0..1), compass heading, hemisphere, interpolated "looks"
src/room/floors.ts          procedural floor presets + paint palette
src/room/outside.ts         per-window diorama (own Scene → render target → pane), weather, seeded layout
src/interactions/placement.ts  placed items: drop, drag, rotate, raise (wall-only), delete, overlaps, door swings
src/interactions/wallPicker.ts click a wall → menu → pick corners → window (4 shapes), corner window (one pick per wall), or door; click an opening → remove
src/interactions/wallGrid.ts   wall-local coordinates, WindowSpec, door swing arc + collision math
src/interactions/windowMesh.ts window dressing (pane + shadow-only leaf proxy + area light)
src/interactions/models.ts     GLB loading, GLB sanitizing, pivot/scale normalization, procedural stand-ins
src/interactions/lamps.ts      lamp registry (glow + point light at sunset/midnight)
src/interactions/measure.ts    Measure tool: two clicks on floor/walls/furniture → distance (inch-snapped)
src/interactions/specBuilder.ts FurnitureSpec → geometry (Dianne's schema), plus tidySpec fixes
src/interactions/share.ts      plan ⇄ URL encoding (base64url JSON)
src/interactions/units.ts      inch/meter helpers, snapping
src/catalog/catalog.ts         catalog store (fixtures + public/demo-assets/catalog.json)
src/catalog/sidebar.ts         bottom bar: catalog cards, paint, floor, sun, outside view
src/catalog/detail.ts          product detail sheet (has the "shopping info" slot)
src/catalog/thumbnails.ts      offscreen thumbnail renderer for cards
src/catalog/shopBar.ts         right drawer: furniture "browser" (search / paste a link / add your own) + ★ shopping agent
src/commerce/budgetBar.ts      right drawer: budget vs. room total, cheaper swaps, shopping plan (Linda)
src/commerce/productForm.ts    "Add your own product" form (read a link / paste listing text / type it)
src/commerce/catalogAdd.ts     product → catalog (+ localStorage) → Cindy's importer for a 3D model
src/commerce/*.ts              pure budget / alternatives / shopping-plan / sourcing logic (tested)
src/lib/commerce/productSourcing.ts  client for services/api: POST /api/v1/products/{import,search}
server/shop.mjs                shopping agent (OpenAI web_search, strict JSON) + page previews
src/measure/*                  Safari phone rangefinder page (measure.html)
public/demo-assets/            Dianne's GLBs (college-bed/desk/chair) + catalog.json
```

## Conventions that must hold

- Meters internally, inches at every input boundary. `INCH_M = 0.0254`. Grid is 1 inch.
- Room origin is the center of the floor, floor at y = 0, back wall at −Z, left wall at −X. Models pivot
  bottom-center and face +Z (contract). The loader re-centers and rescales anything that doesn't.
- Furniture never floats: y > 0 is allowed only while the footprint touches the back or left wall.
- Everything in the plan URL is the source of truth for sharing: dimensions, windows/doors (inches),
  items (`SceneItem[]`), paint, floor, sun (`t` 0..300, `hd`, `sh`), outside view (`vw`).
- The wall picker and the placement controller share the canvas. `canvas.dataset.busy` (furniture gesture
  in progress) and `canvas.dataset.picking` (window/door corner picking) are the hand-off flags.
- Big GLBs: compress with `npx @gltf-transform/cli optimize in.glb out.glb --compress meshopt --texture-compress false --simplify false --palette false`
  (the loader has the meshopt decoder wired in). Keep `--palette false`, or material names/colors get merged away.
  If a Blender export's leaf/fabric color came from a procedural shader, the GLB material has no baseColorFactor and renders white;
  set one in the material (see how `monstera-plant.glb` was patched) before compressing.
- GLB quirk: three's GLTFLoader treats a node `extras.pivot` as its own pivot array. Dianne's exporter writes
  the string `"bottom-center"` there; `models.ts` strips it before parsing. Ask Dianne to rename it.

## Integration points

**Dianne (models).** Add products + assets to `public/demo-assets/catalog.json` (`{ products, assets,
keepFixtures }`, shapes from `packages/contracts`). `glbUrl` may be a real path or `fixture:<kind>` for a
procedural stand-in. Lamps (category `lamp`) automatically glow at night. The room shell in `src/room/` is
a placeholder; if replacing it, keep the `RoomShell` surface: `group`, `walls`, `setWindows`, `setSun`,
`setWallColor`, `setFloor`, `setView`, `setGridVisible`, `setWallHighlight`, `update(dt, time, renderer)`.

**Linda (commerce).** Wired. `placement.onChange` also calls `budget.refresh()`; the Budget chip (under
Measure) opens `#budgetbar` (`src/commerce/budgetBar.ts`), which derives everything from `placement.items` +
the catalog: room total vs. budget (kept in the plan URL as `b`), cheaper same-category swaps ("Swap in"
replaces the placed item in place via `placement.remove` + `add` with the same id), "Make this room fit my
budget", and a per-store shopping plan to approve / copy. The detail sheet's shop slot shows price · store ·
listing link. Prices are `priceUsd` on `Product`; `0` means unpriced (listed, not counted).

**Phone measuring.** `measure.html` (alias `/m`) uses the camera + tilt sensor over https and POSTs
`{ w, d, h }` inches to `/api/measurement`; the open desktop form polls it. The native ARKit app in
`ios/` is the higher-accuracy alternative and needs Xcode once.

## Add furniture from a link (OpenAI)

`server/import-product.mjs` + the `shopApi` plugin in `vite.config.ts` expose `POST /api/import-product { url }`.
It scrapes the page (JSON-LD, meta tags, dimension mentions, up to 3 product images inlined as data URLs), asks
OpenAI (`OPENAI_MODEL`, default `gpt-4o-mini`, strict JSON schema) for catalog data plus a **FurnitureSpec** in
Dianne's schema, writes the spec to `public/demo-assets/generated/`, appends the product+asset to `catalog.json`,
and caches the whole result by URL under `.cache/imports/`. Assets use `glbUrl: "spec:/demo-assets/generated/<id>.spec.json"`,
which `src/interactions/specBuilder.ts` turns into geometry (box / rounded-box / cylinder / shade, repeats).
Cost guard: each call's tokens are priced and tallied in `.cache/openai-usage.json`; calls refuse past
`OPENAI_SESSION_BUDGET_USD` (default $5). One import is ~$0.001. Keys live in `apps/web/.env` (gitignored).
Never call the API from unit tests. To regenerate an item, delete its `.cache/imports/<hash>.json`.

## Shop drawer (Linda's sourcing API) + ★ shopping agent (OpenAI web search)

The ⌕ button (top right) opens `#rightbar` (`src/catalog/shopBar.ts`, 340px, pushes the stage/bottom bar like the
left drawer; the Budget drawer shares the right edge, so opening one closes the other). The address bar takes:
- **a search** ("small white desk") → `POST /api/v1/products/search` on the FastAPI service (`services/api`;
  Google Shopping via SerpAPI, fixture results without a key). The category is guessed from the words
  (`guessCategory`) and the price limit defaults to the remaining budget; "Refine ▾" overrides type / max $ /
  region / target size. Hits are ranked by `productSearch.ts` (price, size, style) and shown as cards.
- **a pasted link** → `POST /api/v1/products/import` reads the page (structured data → text → AI lookup when the
  store blocks reading) for title, price, W×D×H, then adds it straight away.
- **"+ Add your own product"** → `src/commerce/productForm.ts`: read a link, paste the listing text (parsed in the
  browser), or type title / price / category / size; validated against the Product schema.

"Add to catalog" (`src/commerce/catalogAdd.ts`): a hit missing dimensions has its link read first; if the merged
draft is complete it becomes a `Product` (id `imp-<sha1(url)[:16]>`, the same id Cindy's importer uses, so the two
never duplicate a page), joins the catalog at once (sized box), is remembered in `localStorage`
(`dreamgrid.products`, restored on load), and then `POST /api/import-product` is asked for a FurnitureSpec model in
the background (needs an OpenAI key; falls back to the box). A draft still missing something (typically the price
— AI-reported prices are never trusted) opens the form prefilled. The Vite dev server proxies `/api/v1` to
`DREAMGRID_API_URL` (default `http://127.0.0.1:8000`; `pnpm dev` at the repo root starts both servers).

The ★ in the drawer head switches to Cindy's agent: a plain-language request plus optional "fits within" W/D/H in
inches — typed, or filled by the "measure" links which run `MeasureTool.measureOnce` (two clicks in the room →
inches). Its picks use the same "Add to catalog" path. Endpoints in `server/shop.mjs` via the `shopApi` plugin:
- `GET /api/search-products?q=` — the agent with no size limits (no longer used by the drawer; kept for scripts).
- `GET /api/preview-product?url=` — scrape only (title/price/image/dims), in-memory cache, no API cost.
- `POST /api/shop-agent { prompt, fitsIn:{w,d,h} }` — ONE `OPENAI_SEARCH_MODEL` (default `gpt-4.1-mini`) call with
  web search + strict JSON: up to 5 real product pages with price, `[w,d,h]` inches, fit verdict and a reason;
  then a free scrape per pick. ~$0.015/run, cached by prompt+limits under `.cache/shop/`. Shares the session
  budget/tally with the importer (`createUsage` in `import-product.mjs`; search tool calls counted at $0.01 each).
The OpenAI key comes from `apps/web/.env` `OPENAI_API_KEY`, or the repo-root `.env` `OPENAI_KEY` when that is empty.

## Known gaps / ideas

- Collision feedback is bounding-box only (rotations are 90° steps, so boxes stay axis-aligned).
- No placed-items inventory panel yet (manifesto lists it under Cindy).
- The diorama renders every frame per window; if many windows, render every other frame.
- The dev-only debug hook `window.__dg` exposes scene/shell/placement for console poking.
