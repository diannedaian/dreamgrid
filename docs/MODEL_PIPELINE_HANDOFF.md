# Image-first model pipeline — Cindy handoff

Status: implemented laptop MVP; one live GPT-to-Blender path verified September 19, 2026.
Branch: `codex/image-model-pipeline`, based on `codex/generation-college-bed`.
No room, catalog UI, dragging, or budget behavior is changed by this branch.

## What this actually does

One product image becomes a **template-based stylized approximation** with confirmed
outer dimensions. GPT selects a family, colors, drawer side/count, shelf count, and
explicit dimension evidence. Trusted code compiles the recipe; Blender exports GLB.
This is not arbitrary image-to-CAD, photogrammetry, manufacturing geometry, or a fit guarantee.

Supported families: plain dorm bed, pedestal desk, four-leg desk, four-leg upholstered
chair, wooden sled chair, open bookcase, and simple table lamp. Unusual/unsupported
objects fail explicitly. No Meshy/Tripo calls are implemented yet. Preset mode is an
explicit opt-in approximation, never a silent replacement claimed to match the photo.

## Setup on Dianne's laptop

1. Pull this branch (or its merged successor) and run `pnpm bootstrap`.
2. Install Blender; the default executable is `/Applications/Blender.app/Contents/MacOS/Blender`.
3. Copy `services/api/.env.example` to `services/api/.env` only if the latter does not exist.
4. Set `OPENAI_API_KEY` locally. Never put it in chat, Git, a `VITE_` variable, or frontend code.
5. Run `pnpm dev`. API is `http://localhost:8000`; interactive endpoint docs are `/docs`.

`pnpm dev:api` runs from `services/api`, so it reads that directory's `.env`.
Restart the API after changing `.env`. All API calls and generated asset downloads
must use Cindy's configured `VITE_API_BASE_URL`, not the frontend's asset origin.
By default both frontend and backend run on Dianne's laptop for the demo.

## Import panel UX

1. Upload/paste **one product image** (PNG/JPEG/WebP, at most 5 MB and 20 MP).
2. Optional: product URL and pasted product specifications (at most 6,000 characters).
3. Prepare the import. Show the returned image/title/category and labeled width,
   depth, height, including each measurement's source/evidence.
4. Let users edit the sizes in inches/cm/m. Convert to meters before sending.
5. Require confirmation. If any unchanged size is `estimated`, require a separate
   “Use estimated size” checkbox. Keep an Estimated size badge in inventory.
6. Start generation, show queued/generating state or a correctly sized placeholder.
7. Poll for completion and replace the placeholder with the returned GLB. Preserve
   its SceneItem placement and rotation; do not rescale the model a second time.

The user approved image-first import, URL assistance, explicit default-size estimates,
and laptop execution. Unknown dimensions must never be represented as verified facts.
Geometry matches the chosen outer envelope, not necessarily the real product's unknown size.

## Four endpoints

| Endpoint | Input/result |
|---|---|
| `POST /api/v1/models/prepare` | Image + optional context → `PreparedImport` |
| `POST /api/v1/models/generate` | Import ID + confirmed sizes → `GenerationJob` (HTTP 202) |
| `GET /api/v1/models/jobs/{jobId}` | queued/generating/ready/failed; asset only when ready |
| `GET /api/v1/models/assets/{hash}.glb` | Self-contained GLB |

Canonical additive schema: `packages/contracts/schemas/model-pipeline.schema.json`.
Types/validators are exported from `@dreamgrid/contracts`. Existing Product, ModelAsset,
SceneItem, and room contracts remain field-for-field unchanged. The new job envelope
avoids pretending a queued model already has a valid asset URL.

Prepare request:

```json
{
  "imageDataUrl": "data:image/jpeg;base64,...",
  "sourceUrl": "https://mitylite.com/products/chairs/campus-2-chair",
  "productText": "Overall width 19.25 inches, height 33 inches, depth 22 inches.",
  "categoryHint": "chair",
  "mode": "live"
}
```

Only `imageDataUrl` is required. `categoryHint` is optional in live mode. For an
explicit offline approximation, use `mode: "preset"` and a required category hint.
That path still validates the upload, but **does not analyze it**; warnings say so.
The UI must not automatically retry in preset mode without showing that choice.

Generate request after the review screen:

```json
{
  "importId": "<32-character ID returned by prepare>",
  "productId": "<Cindy's stable item/product ID>",
  "dimensions": { "widthM": 0.48895, "heightM": 0.8382, "depthM": 0.5588 },
  "confirmed": true,
  "acceptEstimated": false
}
```

Dimensions must be finite, 0.05–5 meters per axis. These are bounded model inputs,
not ergonomics checks. Estimates use named example presets (not claimed category
averages). A changed size is marked `user`; an unchanged estimate stays `estimated`
and needs explicit acceptance. All source-extracted values remain reviewable candidates.
Evidence from supplied/page text must actually appear there. Simple quoted unit
conversions are recomputed deterministically; compound/fractional text needs careful review.

## Client helper and room integration

Use `apps/web/src/lib/modelGeneration/client.ts`:

```ts
const api = createModelGenerationClient();
const prepared = await api.prepare({
  imageDataUrl: await furnitureImageDataUrl(file),
  productText: specificationText,
  sourceUrl: shoppingUrl || undefined,
}, abortController.signal);

// Render the review panel here. Do not auto-confirm estimates.
const job = await api.generate({
  importId: prepared.importId,
  productId,
  dimensions: {
    widthM: measurementToMeters(enteredWidth, unit),
    heightM: measurementToMeters(enteredHeight, unit),
    depthM: measurementToMeters(enteredDepth, unit),
  },
  confirmed: true,
  acceptEstimated: userCheckedEstimatedSize,
}, abortController.signal);

// Poll api.job(job.jobId) every ~750–1,000 ms while mounted, for at most 90 seconds.
// Stop polling on ready/failed, timeout, or unmount. A timeout is not a successful model.
// On ready, use latest.asset with the existing ModelAsset scene component at scale 1.
```

The helper validates responses and converts backend-relative GLB URLs to the API
origin. Do not manually prefix them again. Canceling an HTTP request does not cancel
an already accepted Blender job; it finishes and can be retrieved/cached.

Preserve the full job's `dimensions` provenance separately from ModelAsset, and show
its `disclosure`. A retry with the same import/product/sizes returns the same active
or completed job. Editing dimensions uses the stored analysis and makes **no new GPT call**.
If category/template is wrong, prepare again with clearer context or choose an
explicit category preset; this version has no free-form model editor.

Generation does not require a price and does not create a Product. Cindy/Linda own
shopping metadata and unknown-price handling. Never invent a zero price to imply an
unknown-cost item is free. The shopping URL is input context, not purchase authorization.

## URL assistance limits

Only a single HTTPS HTML page is fetched from exact configured hosts (default:
`mitylite.com`, `www.ikea.com`, `www.target.com`). No redirects, cookies, login, browser
automation, PDFs, retailer search, reverse-image lookup, or anti-bot bypass.
Private/reserved network targets are blocked; TLS uses a pinned validated public IP.
Page size/time and extracted text are bounded. This is best-effort dimension context,
not universal scraping. JavaScript-only specs, PDF brochures, and blocked pages should
fall back to pasted specification text. The source image is never fetched from arbitrary URLs.

## Cost, speed, and failure behavior

- Default configurable model: `gpt-4.1-mini-2025-04-14` (image input, structured output).
- One GPT request per uncached live preparation; no automatic paid retry or web-search tool.
- Images are resized to at most 1024 pixels and re-encoded without metadata.
- At most 900 output tokens; `store: false`; API errors never echo provider bodies.
  This is not a claim of zero provider-side retention. The user-selected image is sent
  to OpenAI for analysis. See [image input documentation](https://developers.openai.com/api/docs/guides/images-vision)
  and [structured output documentation](https://developers.openai.com/api/docs/guides/structured-outputs).
- Input/output token usage is returned for display. Cached preparation returns zero new tokens.
- Analysis cache: 32 entries, up to 1 hour; imports: at most 100. No raw images saved to disk.
- Default live-call cap: 30 attempts per API process. It resets on restart and is **not**
  an account-level spending cap; set a project budget in the provider dashboard too.
- One Blender process at a time, at most four pending builds, 35-second process timeout.
- No Cycles preview rendering in the runtime path. GLB cache lives in ignored
  `artifacts/generated-models/`, keyed by compiled recipe, dimensions, and style version.
- Jobs are bounded in-memory state (100 per process). Restart loses imports/job IDs;
  generated files survive. Re-prepare after a 404. One API worker only.
- HTTP 400/422: fix input or explicitly accept estimates; 404: expired/missing state;
  429: session/queue busy or cap reached; 502/503: provider/config unavailable.
- Failures stay failures. Offer preset mode or the existing curated demo assets explicitly.

Measured live chair test: **5.37 s analysis, 9.60 s total**, 2,226 input tokens and
129 output tokens, with pasted product dimensions. One successful sample, not a
latency/reliability guarantee. All seven templates were also built at non-default
dimensions and loaded in Three.js; offline fresh builds took about 0.5–2.5 s locally.
The tested manufacturer HTML page did not expose readable dimensions through the
bounded lookup; its pasted specification text worked. Do not rehearse a URL-only demo.

## Verification

```bash
pnpm check
# Optional real Blender smoke test; no network or paid calls:
.venv/bin/python tools/blender/check_pipeline_templates.py
# Inspect an exported smoke model with the actual Three.js loader:
node tools/blender/inspect-glb.mjs artifacts/pipeline-template-checks/shelf.glb artifacts/pipeline-template-checks/shelf.json
```

Automated tests use fake providers/builders. They cover required confirmation,
size provenance, defaults, cache reuse, API failures, request limits, source-host
restrictions, unit conversions, template schema validity, and frontend URL resolution.
The local HTTP prepare/generate/poll/download flow was also checked with an explicit
lamp preset: asset download returned 200 with the correct GLB media type and frontend CORS origin.

## Deployment later

Keep Cindy's prepare/generate/poll/asset interface; replace the execution/storage internals.

1. Run a Linux VM/container with Blender and its OS libraries. Ship the **repository's
   templates and trusted builder** as well as the API; the Python wheel alone is insufficient.
   A static frontend host or short-lived function is not a drop-in Blender backend.
2. Replace process-memory jobs/imports with durable shared state and a bounded worker queue.
   Multiple API workers currently would lose each other's job IDs; do not enable them yet.
3. Put generated assets in object storage and return accessible HTTPS asset URLs.
4. Add user authentication, per-user limits, a durable spending budget, and controlled
   network egress before public exposure. CORS and random IDs are not authentication.
5. Run Blender in a restricted OS/container user with CPU/memory/time limits. Today it
   runs only trusted code with an environment stripped of API keys, but is not an OS sandbox.
6. Configure exact frontend origins, HTTPS, secret storage, retention/cleanup, job retries,
   health checks, logging without images/keys, and concurrent-load tests.

For the hackathon, leave the server loopback-only and run the demo frontend on the same
laptop. Do not expose this unauthenticated development server through a public tunnel.

## Agent starting instruction for Cindy

Read this document and `apps/web/AGENTS.md`. Use the existing modelGeneration client
to add image import, source-labeled size review, explicit estimate acceptance, generation
status, and scene insertion. Keep API/Blender generation unchanged; keep transforms in
SceneItem, meter units, Y-up, +Z front, floor-centered pivot, and scale 1. Use the returned
productId consistently. Preserve cached demo assets and visibly disclose approximate/preset
models. Do not add API keys to the browser or treat unknown prices as zero.
