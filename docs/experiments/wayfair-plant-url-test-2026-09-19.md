# Wayfair plant + planter URL test

Date: September 19, 2026.

Wrap-up configuration update: the backend and `.env.example` now default to the
successful retry's `gpt-5.6-sol` / high / 12,000-token / 600-second configuration.
Historical statements below about unchanged defaults and unpublished changes
describe each test at the time it ran, not the final branch state. URL-only import
is still not implemented; raw artifacts remain local and ignored.

**Latest status: after adding decor and an explicit stylized-leaf policy, a fresh Sol run produced a valid GLB in 115.7862 seconds; it loads in Three.js and is served by the local API. Visual review found a disconnected leaf. URL-only import remains unimplemented/blocked.** Earlier failed attempts are retained below; the final section records the successful technical retry and its visual limitation. This is not a successful automatic URL-to-model benchmark.

## Requested result

Use the Wayfair link as the only product input, retrieve its reference image and dimensions, generate the pictured plant plus planter with GPT-5.6 Sol and Blender, and measure total processing time. Dianne confirmed that foliage dimensions may be estimated, provided those estimates are clearly labeled.

## What was observed

1. The existing backend's bounded product-page fetch was called with the supplied product path and both selected variant IDs, explicitly allowing `www.wayfair.com` for this diagnostic only. Tracking parameters were omitted; selected variant IDs were preserved.
2. Fetching stopped after **0.2797 seconds**, measured with `time.perf_counter()`. The adapter returned `Product page could not be read. Paste its specifications instead.` That error means the response was not an accepted HTTP-200 HTML page; this diagnostic did not record the exact upstream status. No dimensions or image reached the model.
3. A separate manual browser investigation loaded a product summary at the supplied link. It showed a white round planter with a leafy plant and selected size **21.3-inch diameter × 16.5-inch height**, with a 14.6-inch pot opening. These are planter measurements, not dimensions of the entire plant.
4. The summary linked to the current [Wayfair product-detail page](https://www.wayfair.com/outdoor/pdp/wrought-studio-marlo-fiberstone-round-planter-85-pot-opening-smooth-finishes-lightweight-durable-uv-resistant-modern-minimalist-home-decor-indoor-outdoor-plant-pot-w121020505.html?piid=129228190%2C129228193). Opening that link returned an access-denied page with a press-and-hold human-verification challenge. The challenge was not completed or bypassed. The browser tab was retained for user handoff.

## Initial preflight timing and usage

| Stage | Result |
| --- | --- |
| Direct backend product-page fetch | Failed after 0.2797 s |
| Automatic product-image retrieval | Not reached |
| Automatic complete-object dimensions | Not reached |
| GPT-5.6 Sol | Not called; zero tokens used |
| Blender / GLB | Not run; no new model |
| URL → ready GLB | Unavailable; do not substitute the earlier lamp's timing |

Browser investigation and clarification were not timed as automated pipeline work. There is no legitimate end-to-end generation number for this attempt.

## Confirmed scope and remaining gap

- Model **plant plus pot**, not just the planter. The planter's displayed measurements convert to 0.54102 m diameter and 0.41910 m height; opening diameter is 0.37084 m. These values were observed in the browser, not extracted by the backend.
- Total plant height and foliage spread are not specified. Any later estimates must remain labeled estimates. Do not scale the whole plant to the planter's height.
- The current service is still image-first: it accepts an uploaded image plus optional product URL/text. Its URL helper extracts bounded page text; it does not yet retrieve product images or implement a general URL-only import. This test did not silently add that feature or change the public API.
- Completing a browser challenge may permit a browser-assisted test, but does not prove the server-side fetch will work. Any assisted result must be documented separately from a fully automatic backend run.
- Next required action: user completes Wayfair's browser verification, or supplies a screenshot/image for an explicitly image-first fallback. Neither fallback should be called successful URL-only automation.

The OpenAI Docs skill was used to check the intended Sol settings against [official model documentation](https://developers.openai.com/api/docs/models/gpt-5.6-sol); access failed before an API request was needed. No model defaults, secrets, shared contracts, or application code were changed during this preflight. No commit, push, or merge was made.

## Follow-up after user browser verification

The user completed Wayfair's human verification. The browser product page then loaded successfully, still showing the large white 21.3-inch diameter × 16.5-inch-high planter. Wayfair changed the active variant IDs to `214988625,214988654`; the selected size and color were rechecked in the visible page. A separate backend request still failed in **0.2305 seconds**. Browser access did not grant access to the server-side connection.

The chat's browser asset tool retrieved the product photo in **55.1479 seconds**. This was a **browser-assisted import**, not functionality implemented in DreamGrid. Only the product image was downloaded; browser cookies were not copied to the backend. The resulting local image and browser-observed specifications were passed into the same `Pipeline` class used by the FastAPI model routes.

### Generation test configuration

- Model: `gpt-5.6-sol`, high reasoning, high image detail, strict geometry schema, no automatic retries.
- One API request, 12,000 maximum output tokens, 600-second timeout.
- Subject: pictured plant plus planter, as explicitly approved by Dianne. The retail planter does not include the illustrative plant.
- Assistant-selected estimated full envelope: **1.15 m wide × 1.75 m high × 0.95 m deep**. All three axes were explicitly marked estimated; pot-only measurements were supplied separately, never as full plant dimensions.
- Generation started at `2026-09-19T18:56:17.433317+00:00`.
- No manual geometry changes or second paid attempt were made. Backend defaults and application code were unchanged.

### Follow-up measurements

| Stage | Seconds / result |
| --- | --- |
| Browser-assisted photo retrieval | 55.1479 s, successful; separate tool timing |
| Sol request | 89.6509 s, completed structured response |
| Backend preparation through rejection | **91.1561 s**, including image normalization and Sol request |
| Blender export / Three.js load | Not reached |
| URL → ready GLB | **No successful result** |

The summed image-retrieval and failed-preparation process times are 146.3040 seconds. This excludes browsing, human verification, research/decision time, and tool-launch gaps; **it is not a continuously measured end-to-end latency**.

Reported API usage: 2,820 input tokens (1,365 cached; 1,452 cache-write tokens reported), 8,046 output tokens including 5,286 reasoning tokens; total 10,866. Application-level analysis was fresh, not reused. This supersedes the initial preflight's zero-token count only for the separate follow-up run.

### Why it failed

Sol returned 26 proposed parts but `supported: false`. Its reasons were the missing plant/decor category in the generation schema and the inability of the available primitives to represent the characteristic split, perforated, pointed monstera leaves faithfully. It used `shelf` only as a required schema placeholder, not a valid product classification. The backend correctly rejected that response rather than building it as a shelf or silently substituting a preset.

This is an **application schema/representation limitation**, not evidence that the API request failed or that Blender was slow. A compliant next implementation would add decor to the generation category contract and provide a bounded leaf representation or explicitly agreed simplified-leaf policy. That is a follow-up change, not something this benchmark already supports. The user's accepted visual quality bar should guide that work; the exact-fidelity gate was stricter than the user's willingness to accept a stylized plant.

### Saved evidence

- `artifacts/sol-plant-test/reference.webp`: the exact downloaded product image.
- `artifacts/sol-plant-test/browser-input.json`: source URL/image, selected variant, browser timing, and dimension provenance.
- `artifacts/sol-plant-test/provider-geometry.json`: unmodified Sol response, including its unsupported decision.
- `artifacts/sol-plant-test/provider-geometry.metadata.json`: returned model, request timing, and tokens.
- `artifacts/sol-plant-test/result.json`: failed stage, elapsed time, and one-call count.

No GLB, Blender scene, or rendered preview was produced. All raw image/response artifacts remain local and git-ignored. Cindy's frontend cannot reproduce the browser-assisted import by calling our current endpoints; the image-first backend portion is real code but this particular plant is not yet supported by its generation contract.

## Retry after the requested decor-category change

The user requested adding plant/decor support. `decor` was added to the backend generation category and generated JSON schemas; TypeScript's `GenerationCategory` now aliases the catalog's existing `ProductCategory`. Plants use `decor`, not a separate `plant` enum. Existing furniture categories/presets are unchanged. Asking for a decor preset returns HTTP 400 without calling AI; no plant template was introduced.

The prompt was also aligned with the user's accepted stylization: thin ellipsoid leaves are permitted, with omitted splits/holes disclosed. This was **a category and fidelity-policy change**, not proof that merely changing a label improved geometry. No new primitive or executable-code escape hatch was added. The previous rejected result was not altered or reused.

### Fresh-run speed

Same saved Wayfair photo, same manually supplied component-size context and estimated 1.15 × 1.75 × 0.95 m full envelope, plus `categoryHint: "decor"`. `gpt-5.6-sol`, high reasoning, high image detail, 12,000 output-token ceiling, 600-second timeout. One fresh request; no automatic retry. Start: `2026-09-19T19:02:22.796405+00:00`.

| Stage | Seconds |
| --- | ---: |
| Sol request (within preparation) | 113.9200 |
| Image preparation, Sol, validation | 114.0211 |
| Recipe handoff | 0.0097 |
| Blender export and ready job | 1.7554 |
| **Local image → ready GLB** | **115.7862** |
| Separate process: studio scene + two previews | 27.18 |

The successful retry used the already downloaded image: **no new URL/image retrieval was included**. Generating and then rendering took 142.9662 seconds of summed process time, excluding launch gaps. The earlier 55.1479-second browser retrieval was a different step and is not silently included in the ready-GLB number. Total wall time from the original URL request includes failures, browsing, human verification, development and clarification, and is not an app latency measurement.

Usage for this retry only: 2,926 input tokens, 9,471 output tokens including 6,416 reasoning tokens; 12,397 total. Provider reported 0 cached input tokens and 2,923 cache-write tokens. Both application analysis and GLB caches were misses.

### Verification and visual outcome

- Returned `category: "decor"`, `template: "custom"`, `supported: true`; all three full dimensions are labeled estimated.
- Actual runtime GLB: 258,112 bytes, 26 meshes, 11,356 triangles, bottom-center pivot. No lights are attached to this non-luminous decor object.
- Actual Three.js `GLTFLoader` test: **PASS**. Bounds 1.1500000552 × 1.7500000734 × 0.9499999380 m, floor Y = 0, centered footprint, self-contained PBR asset, no studio geometry.
- Local API asset download: **HTTP 200**, `model/gltf-binary`, 258,112 bytes matching the generated file; CORS allowed `http://localhost:5173`. The API was initially stopped and was started locally for this delivery check. This does not establish connectivity from Cindy's separate laptop.
- Visual review of both studio views: recognizable stylized green foliage in a white rounded pot; simplified oval leaves omit the photo's characteristic cutouts and pointed edges. **One upper-right leaf is visibly disconnected from its stem.** No manual correction was applied. Technical validation does not currently detect this connection defect.
- Published pot measurements were reference input, not a separately validated output guarantee: the builder normalizes the complete estimated envelope. Do not claim exact component-scale preservation.
- `pnpm check`: **80 tests passed** (9 contracts, 15 frontend, 46 API, 10 asset tests), plus lint, type checks, and production build.

### Artifacts and handoff

- `artifacts/sol-plant-decor-test/result.json`: fresh run timings and ready asset metadata.
- `artifacts/sol-plant-decor-test/provider-geometry.metadata.json`: provider timing and usage.
- `artifacts/sol-plant-decor-test/provider-geometry.json`: unmodified AI output.
- `artifacts/sol-plant-decor-test/recipe.json`: builder input.
- `artifacts/sol-plant-decor-test/preview/recipe-preview.png`, `recipe-top-preview.png`, and `recipe.blend`: inspected previews and editable scene.
- `artifacts/generated-models/020db28061b2c1a9845504f0285d0924749fd42a7568d8ecc5d7ebd0c3a0e93a.glb`: actual runtime asset; API route `/api/v1/models/assets/020db28061b2c1a9845504f0285d0924749fd42a7568d8ecc5d7ebd0c3a0e93a.glb`.
- `fixtures/plant-prepared-import.json`: synthetic review fixture shared with frontend agents, not a live import ID.

This verifies decor-category integration and a successful image-to-GLB generation path, **not visual perfection or automatic retailer import**. Default backend model/settings remain unchanged. In particular, this 114-second preparation used a longer test timeout and more output tokens than the normal backend defaults; matching the Sol test setup is still required before Cindy can reproduce this quality through the ordinary server configuration. Changes and artifacts remain local; no push or merge was performed.
