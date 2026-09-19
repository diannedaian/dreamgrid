# Image-first model pipeline — Cindy handoff

Status: laptop MVP, September 19, 2026. Branch: `codex/image-model-pipeline`.
Default generation model: **`gpt-5.6-sol`, high reasoning**.

## Integration update: `codex/connect-generation`

The backend and builder are now integrated into Cindy's current vanilla Three.js
app without replacing her app shell. `+ Add furniture` and the shop-card buttons
open the live image-first flow, confirm dimensions, poll Blender and insert the
returned GLB automatically. See `apps/web/HANDOFF.md` for the authoritative current
UI wiring. The React/client-helper examples below describe the earlier branch,
not modules to copy into the current app.

Current client: `apps/web/src/catalog/generationClient.ts`. Current proxy:
same-origin `/api/v1` → `DREAMGRID_API_TARGET` (default localhost:8000).
The API's image requirement and URL lookup limitations below still apply.
Generated catalog entries persist in this browser/origin; GLBs persist on the
laptop. Cross-browser sharing of newly generated catalog metadata is not implemented.

## What is implemented

One product image → Sol-authored custom geometry JSON → validated FurnitureSpec →
trusted Blender builder → normalized GLB URL. Live generation does **not** select a
predefined furniture template and never runs AI-written Python. Sol chooses bounded
parts, their arrangement, materials and lamp emitters from the supplied image.

Categories: `bed`, `desk`, `chair`, `shelf`, `lamp`, `decor`. Plants, planters and
vases use `decor`. Live imports return the legacy field `template: "custom"`.
Existing furniture presets remain an explicit offline option only; no decor preset
exists. Never silently substitute one for a failed live generation.

This is a stylized shopping preview, not exact reconstruction or a fit guarantee.
Hidden details and plant leaf cutouts can be simplified. The chosen overall bounding
dimensions are validated; independently accurate component dimensions are not.
Meshy/Tripo fallback and URL-only image import are **not implemented**.

## Local setup and Sol configuration

1. Pull this branch (or its merged successor), then run `pnpm bootstrap`.
2. Install Blender. Tested: Blender 5.2.1 LTS on Dianne's Mac.
3. Copy `services/api/.env.example` to `services/api/.env` only if it does not exist.
4. Set `OPENAI_API_KEY` in that ignored file. Never put keys in Git, chat, browser
   code or a `VITE_` variable. Existing `.env` files override the new code defaults;
   update the following settings if upgrading from the earlier mini-based version:

```dotenv
DREAMGRID_OPENAI_MODEL=gpt-5.6-sol
DREAMGRID_OPENAI_REASONING_EFFORT=high
DREAMGRID_OPENAI_MAX_OUTPUT_TOKENS=12000
DREAMGRID_OPENAI_REQUEST_TIMEOUT_SECONDS=600
DREAMGRID_BLENDER_PATH=/Applications/Blender.app/Contents/MacOS/Blender
```

5. Run `pnpm dev`. API: `http://localhost:8000`; API documentation: `/docs`.

`pnpm dev:api` runs from `services/api` and reads its `.env`; restart after edits.
All requests and GLB downloads use `VITE_API_BASE_URL`. On Cindy's laptop,
`localhost` means **Cindy's laptop**, not Dianne's. The supported hackathon setup is
frontend and backend together on Dianne's laptop; separate-laptop hosting needs an
explicit connectivity/security setup. Do not expose this unauthenticated server publicly.

The OpenAI Docs skill was used to verify the exact model and Responses parameters
against [official Sol documentation](https://developers.openai.com/api/docs/models/gpt-5.6-sol).
The defaults match our tested configuration; no claim is made that high reasoning
is the fastest or cheapest usable setting.

## Import interaction and endpoints

1. Upload/paste one PNG/JPEG/WebP product image (up to 5 MB, 20 MP).
2. Optionally add a product URL and/or pasted specifications (up to 6,000 characters).
3. Prepare and show title, warnings, category and source-labeled width/height/depth.
4. Let the user edit sizes; convert inches/cm to meters. Require confirmation and
   explicit acceptance of every estimated axis. Keep estimates labeled in inventory.
5. Generate, poll, then insert the ready asset into the room without resizing again.

| Endpoint under `/api/v1/models` | Purpose |
|---|---|
| `POST /prepare` | Image + optional context → `PreparedImport` |
| `POST /generate` | Import ID + confirmed sizes → `GenerationJob` (HTTP 202) |
| `GET /jobs/{jobId}` | queued / generating / ready / failed |
| `GET /assets/{hash}.glb` | Self-contained GLB |

The expensive Sol request happens in **prepare**, before the generation job exists.
Show “Analyzing image” then; do not put a 30-second timeout on preparation. Allow
the configured 600-second provider timeout plus a margin for optional page lookup.
Poll the Blender job every ~1 second, stopping on ready/failed or unmount; allow up
to 160 seconds for four queued builds, each with a 35-second process limit. A timed
out/cancelled browser request does not guarantee backend work stopped. Do not
automatically retry a paid preparation.

Use `apps/web/src/lib/modelGeneration/client.ts`, with contracts from
`@dreamgrid/contracts`:

```ts
const api = createModelGenerationClient();
const prepared = await api.prepare({
  imageDataUrl: await furnitureImageDataUrl(file),
  productText: specificationText,
  sourceUrl: shoppingUrl || undefined,
  categoryHint: 'decor', // Optional; omit to let Sol classify.
  mode: 'live',
}, signal);

// Render and confirm the size-review panel before this call.
const job = await api.generate({
  importId: prepared.importId,
  productId,
  dimensions: { widthM: 1.15, heightM: 1.75, depthM: 0.95 },
  confirmed: true,
  acceptEstimated: true, // Only after explicit user acceptance.
  estimatedAxes: ['width', 'height', 'depth'],
}, signal);

// Poll api.job(job.jobId, signal); insert latest.asset only once status === 'ready'.
```

Those example plant sizes are **estimates**, not retailer measurements. Edited
guesses must stay in `estimatedAxes`; otherwise changed values are treated as user
measurements. Unchanged backend estimates still require acceptance. A planter's
published size is not the size of its pictured foliage. Show all returned warnings
and `asset.disclosure`, and retain `job.dimensions` provenance alongside the asset.

Dimensions must be finite, 0.05–5 m per axis. Supplied/page-text evidence must appear
in the source; simple quoted unit conversions are recomputed. This does not prove
the retailer text identifies the correct variant or component: review still matters.

Editing sizes reuses the saved analysis, with no additional Sol call. The client
helper validates responses and resolves backend-relative GLB URLs automatically;
do not prefix them again. Use `fixtures/plant-prepared-import.json` for offline
review UI development; its import ID is synthetic, not usable with a live server.

## Scene and lamp integration

GLB geometry uses meters, X width, Y up, Z depth; bottom-center pivot; +Z front.
Keep placement/rotation in Cindy's SceneItem parent group and use scale 1.

`ModelAsset.lighting` is a new **optional additive field**. Lamp metadata contains
normalized model-local bulb positions/directions, material names for glow, and
night activation. Non-light objects omit it. Brightness/beam/color are preview
defaults, not measured photometry. The same rig is stored in GLB root extras as
`dreamgridLighting`, but the API field is the client integration contract.

```tsx
// Both siblings must share the same position/rotation parent, not the GLB root.
<group position={position} rotation={rotation}>
  <ModelAsset
    url={asset.glbUrl}
    lighting={asset.lighting}
    lightingMode={roomLightingMode}
  />
  <ModelLights lighting={asset.lighting} mode={roomLightingMode} />
</group>
```

Components live in `apps/web/src/scene/`. `roomLightingMode` is `'day' | 'night'`.
The helper keeps light targets under the same transform and clones glowing
materials per instance so one lamp does not change another. Shadows default off
for performance. Do not also instantiate duplicate lights from GLB extras.
This branch provides tested helpers and metadata; wiring Cindy's actual room
toggle and insertion UI remains her integration work.

### Cindy's current plain Three.js room

At wrap-up, `origin/main` has moved to Cindy's vanilla TypeScript/Three.js room,
while this feature branch still contains the older React backbone. **Do not replace
Cindy's app shell, package configuration or room with this branch's versions.**
The React example above is for the backbone only. The backend/GLB/metadata contract
does not require React; use the pure helpers in `src/scene/modelLighting.ts`:

```ts
// Import Group from three, and these three helpers from modelLighting.
const model = cloneModelForLighting(loadedGltf.scene, asset.lighting);
const lights = createModelLights(asset.lighting, roomLightingMode);
const placedItem = new Group();
placedItem.add(model.instance, lights);
setModelGlow(model.instance, asset.lighting, roomLightingMode);
// Put SceneItem position/rotation on placedItem, not model.instance.

function updateRoomLighting(mode: 'day' | 'night') {
  lights.visible = mode === 'night';
  setModelGlow(model.instance, asset.lighting, mode);
}
```

On removal, dispose the helper-created lights and call `model.dispose()`; do not
dispose geometry/materials shared by other loaded instances. Cindy's existing
`LampRegistry.registerLamp` currently adds one inferred point light. For generated
assets, use the supplied multi-emitter rig instead of registering a duplicate
default light; wire the room's day/night event into the update function. This
integration is documented, not already merged or tested inside Cindy's room.

Before merging, review the backend/shared-contract changes and adapt only the
client/lighting helpers into the current frontend. The branch checks below cover
this branch, not a combined build of the latest room plus generation.

Other additive contract changes: custom lathe/tube geometry, generation `decor`,
`template: "custom"`, and `estimatedAxes`. Product/SceneItem shapes are unchanged.
Review these changes with the consuming agents before merging.

## URL behavior and measured speed

The optional URL helper reads bounded HTML text from exact configured public HTTPS
hosts (MityLite, IKEA, Target by default). It blocks redirects/private networks and
does not run a browser or download product images. Blocked/JavaScript-only pages
need pasted specifications. **Wayfair browser access in this chat is not backend
functionality**; URL-only import is not ready for a demo.

Fresh single-run Sol/high measurements, local image → ready GLB:

| Subject | Preparation | Blender/build | Total |
|---|---:|---:|---:|
| Target dual-head lamp | 86.36 s | 1.90 s | 88.26 s |
| Wayfair pictured plant + pot | 114.02 s | 1.76 s | 115.79 s |

Totals include a tiny diagnostic handoff; exclude human size confirmation, prior
research/browser-assisted image retrieval, HTTP route/browser loading and studio
preview renders. These are single samples, not latency guarantees. See the full
[lamp](experiments/sol-lamp-test-2026-09-19.md) and
[plant](experiments/wayfair-plant-url-test-2026-09-19.md) records. The plant passed
GLB/Three.js validation but has a visibly disconnected leaf; visual review remains
necessary. Blender is not the dominant cost in these samples.

## Limits, verification and deployment

- One uncached Sol request per preparation, no automatic paid retry. Image maximum
  normalized edge: 1024 px. `store: false`; image sent to OpenAI. No claim of zero
  provider retention. Output cap includes reasoning tokens.
- Default cap: 30 live attempts per API process; resets on restart, not a billing
  guarantee. Configure the provider's project budget separately.
- Analysis cache: 32 entries / up to one hour; 100 imports and 100 jobs per process.
  One API worker, one preparation at a time, one Blender worker, four pending builds.
- Imports/job IDs are in memory and disappear on restart. GLBs persist under ignored
  `artifacts/generated-models/`; no user image is saved by the regular API.
- Generated assets: <=2 MB and <=40,000 triangles, validated outer envelope.
  No studio rendering in the runtime path. Benchmark renders/raw images stay local.
- HTTP 400/422: fix input/confirmation; 404: expired/missing state; 429: busy/cap;
  502/503: provider/config unavailable. Failures never become fake successful assets.

`pnpm check` runs offline lint, types, tests and builds. Real generation is opt-in
with `tools/test_image_pipeline.py` and incurs API cost; use a fresh output folder.
Its defaults now inherit backend settings. `--reuse-analysis` avoids another API
call for builder debugging; never report that as fresh generation speed.

For deployment later, keep these client endpoints but add a Blender-capable runtime
with the repository's trusted builder/schemas, durable jobs/queue, object storage,
authentication/limits, HTTPS and restricted worker resources. Multiple API workers,
public tunnels and short-lived serverless functions are not supported substitutes
for today's single-process local setup. Blender receives no API key but is not an
OS sandbox. CORS and random job IDs are not authentication.
