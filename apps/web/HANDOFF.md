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
src/interactions/modelStates.ts  hinged fridge open/close pose; per-instance, cabinet stays fixed
src/interactions/lamps.ts      lamp registry (GLB bulb rigs, or fixture point light, at sunset/midnight)
src/interactions/measure.ts    Measure tool: two clicks on floor/walls/furniture → distance (inch-snapped)
src/interactions/specBuilder.ts FurnitureSpec → geometry (Dianne's schema), plus tidySpec fixes
src/interactions/share.ts      plan ⇄ URL encoding (base64url JSON)
src/interactions/units.ts      inch/meter helpers, snapping
src/catalog/catalog.ts         catalog store (fixtures + public/demo-assets/catalog.json)
src/catalog/sidebar.ts         bottom bar: catalog cards, paint, floor, sun, outside view
src/catalog/detail.ts          product detail sheet (has the "shopping info" slot)
src/catalog/thumbnails.ts      offscreen thumbnail renderer for cards
src/catalog/shopBar.ts         right drawer: furniture "browser" (search / paste a link) + ★ shopping agent
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

The cached **Torchiere + task lamp** includes `dreamgridLighting` GLB extras for two bulbs.
The loader promotes this rig to the glTF scene (positions are already in final exported
model space, not the inner furniture node's coordinates). The registry attaches lights
and targets to that scene, which keeps them aligned through centering, scaling, dragging
and rotation. It uses the rig's named emissive materials; fixture lamps still use the
original inferred single point light. See `lamps.test.ts` for a real-asset regression test.
Generated light intensities use a 0.05 preview scale to match the stylized room's
exposure/bloom; these are not measured lighting predictions.
Live generated lamps use the same registry. The loader prefers `ModelAsset.lighting`
from the backend, falls back to GLB extras, and never adds both rigs.

The supplied **Whirlpool mini fridge** replaces `p-mini-fridge` / `m-mini-fridge`,
so existing fridge placements load the finished asset. `modelStates.ts` binds its
`DOOR PIVOT` hierarchy (glTF Y axis, +110 degrees). The selection toolbar shows
Open fridge / Close fridge only when that hinge loaded successfully. Normalization
happens once while closed; opening never moves or resizes the cabinet. The closed
footprint remains the placement/collision footprint; this is an interior preview,
not a validated door-clearance simulation.

The web-only `Plan.openItems?: string[]` saves open item IDs in room links and saved
designs. Legacy plans stay closed. `SceneItem` and canonical contracts are unchanged.
The catalog's `hiddenProductIds` hides the five retired placeholder cards while
keeping their IDs available to old saved plans; it does not delete those plans.

**Linda (commerce).** Integrated via `src/commerce/README.md`. The Budget action shows
known-price totals, unpriced warnings, ready-model alternatives, swaps/undo and session-only
shopping-plan approval (no payment/Visa call). `main.ts` refreshes from `placement.items` and
catalog changes; hidden catalog cards still count when placed. `Plan.b` carries the USD budget.
The Source products tab adds region/budget/size search and URL/text/manual entry, then opens the
same image-first generation panel. Source details persist locally and generated dimensions win.
The existing Shopping agent and Shopping list tabs, photos, links and quantities are retained.

**Phone measuring.** `measure.html` (alias `/m`) uses the camera + tilt sensor over https and POSTs
`{ w, d, h }` inches to `/api/measurement`; the open desktop form polls it. The native ARKit app in
`ios/` is the higher-accuracy alternative and needs Xcode once.

## Add furniture: live Sol → Blender integration

`+ Add furniture` opens `src/catalog/importer.ts`. Shop cards open that same panel
with the URL prefilled; neither UI calls the legacy simplified importer anymore.

1. Drop or pick a PNG/JPEG/WebP photo (<5 MB); link, price and notes are optional
   (notes/sizes live under "Add sizes or notes"). The backend **requires the photo**;
   URL-only image extraction is not implemented. Blocked listings need pasted specs.
2. `/api/v1/models/prepare` runs one Sol analysis (may take minutes). The panel shows
   the self-assembling chair loader, rotating notes and a real elapsed clock, not an
   invented percentage.
3. Quick size check in inches: `~` marks a backend estimate, `✓` a sourced size. There
   is no acceptance checkbox. Building with untouched estimates sends
   `acceptEstimated: true` with those axes in `estimatedAxes`; a size the user types
   is sent as their measurement. Estimates stay labeled in the asset disclosure.
4. `/generate` starts Blender; `/jobs/{id}` is polled every second. Actual job
   states drive queued/building/ready/error UI. Resume reuses the same job and
   analysis, not another paid call.
5. Await the returned GLB via the existing `PlacementController.add`, insert at
   floor center, and add to the catalog. Drag/rotate/light it using the normal room
   controls. A failed generated GLB download throws, never becomes a dummy box.

Vite proxies `/api/v1` to `DREAMGRID_API_TARGET` (default `http://127.0.0.1:8000`)
in both dev and preview. The browser uses same-origin URLs, including GLB downloads,
so HTTP and HTTPS frontend modes work without mixed content. Production static
hosting must provide an equivalent reverse proxy. Start the API with
`./scripts/dev-api.sh`; keys/model/Blender path stay in `services/api/.env`.
The existing shop-search credentials/budget in `apps/web/.env` are separate.

Generated catalog metadata is stored in localStorage (`dreamgrid.generated-catalog.v1`),
up to 100 entries. Images are not retained there. GLBs live in the API's ignored
`artifacts/generated-models/` directory. Reloads and saved designs work on the same
browser/origin while this backend is running. Shared links on another browser do
**not** carry these generated catalog entries yet; curated demo assets still work.
Unknown prices use the existing numeric `priceUsd: 0` plus `price-not-provided` tag
and visible disclosure, not a claim the product is free. Linda should exclude those
from known-price totals and surface the incomplete budget.

Shared types now come from `packages/contracts/src/`; the previous root `index.ts`
is a compatibility re-export, with no Product/SceneItem field changes. Pipeline
contracts and optional lamp metadata were brought over from the generation branch.
Product source/image URL strings may be empty for image-only imports.

## Legacy simple spec importer (not used by the import UI)

`server/import-product.mjs` + the `shopApi` plugin in `vite.config.ts` expose `POST /api/import-product { url }`.
It scrapes the page (JSON-LD, meta tags, dimension mentions, up to 3 product images inlined as data URLs), asks
OpenAI (`OPENAI_MODEL`, default `gpt-4o-mini`, strict JSON schema) for catalog data plus a **FurnitureSpec** in
Dianne's schema, writes the spec to `public/demo-assets/generated/`, appends the product+asset to `catalog.json`,
and caches the whole result by URL under `.cache/imports/`. Assets use `glbUrl: "spec:/demo-assets/generated/<id>.spec.json"`,
which `src/interactions/specBuilder.ts` turns into geometry (box / rounded-box / cylinder / shade, repeats).
Cost guard: each call's tokens are priced and tallied in `.cache/openai-usage.json`; calls refuse past
`OPENAI_SESSION_BUDGET_USD` (default $5). One import is ~$0.001. Keys live in `apps/web/.env` (gitignored).
Never call the API from unit tests. To regenerate an item, delete its `.cache/imports/<hash>.json`.

## Shop drawer + ★ shopping agent (OpenAI web search)

The ⌕ button (top right) opens `#rightbar` (`src/catalog/shopBar.ts`, 340px, pushes the stage/bottom bar like the
left drawer). The address bar takes a search or a pasted product link; results are cards with "Add to room"
(opens the image/size-review flow above). The ★ in the drawer head switches to the agent: a plain-language request plus optional
"fits within" W/D/H in inches — typed, or filled by the "measure" links which run `MeasureTool.measureOnce`
(two clicks in the room → inches). Endpoints in `server/shop.mjs` via the same `shopApi` plugin:
- `GET /api/search-products?q=` — the same agent as ★ with no size limits (every search in the app goes through
  OpenAI web search; free engines — DuckDuckGo/Bing/Brave/Mojeek — were tried and dropped: rate-limited or degraded).
- `GET /api/preview-product?url=` — scrape only (title/price/image/dims), in-memory cache, no API cost. Cards call
  it lazily to fill images; big retailers (Amazon, Home Depot, Target) block it, so cards may stay imageless.
- `POST /api/shop-agent { prompt, fitsIn:{w,d,h} }` — ONE `OPENAI_SEARCH_MODEL` (default `gpt-4.1-mini`) call with
  web search + strict JSON: up to 5 real product pages with price, `[w,d,h]` inches, fit verdict and a reason;
  then a free scrape per pick. ~$0.015/run, cached by prompt+limits under `.cache/shop/`. Shares the session
  budget/tally with the importer (`createUsage` in `import-product.mjs`; search tool calls counted at $0.01 each).

## Known gaps / ideas

- Collision feedback is bounding-box only (rotations are 90° steps, so boxes stay axis-aligned).
- No placed-items inventory panel yet (manifesto lists it under Cindy).
- The diorama renders every frame per window; if many windows, render every other frame.
- The dev-only debug hook `window.__dg` exposes scene/shell/placement for console poking.
