# Lamp generation benchmark: GPT-5.6 Sol

Date: September 19, 2026. Result: **one fresh API call produced a validated GLB in 88.26 seconds**. The image-specific assembly was generated automatically; no geometry was manually corrected after the response.

Wrap-up configuration update: the backend and `.env.example` now default to this
test's `gpt-5.6-sol` / high / 12,000-token / 600-second configuration. References
below to unchanged defaults or no push describe the experiment at the time it ran,
not the final branch state. Raw artifacts remain local and ignored.

## Input and scope

- Product: [Room Essentials Torchiere with Task Light Floor Lamp, black](https://www.target.com/p/torchiere-with-task-light-floor-lamp-room-essentials/-/A-87922469?preselect=87291863).
- Input: Dianne's supplied product image plus previously researched, manually supplied product text. **This run did not automatically retrieve the URL or discover dimensions.**
- Confirmed envelope, width × height × depth: **0.52 × 1.8161 × 0.2413 meters**. Height is from the published 71.5-inch specification. Width and depth remain **user-approved estimates**, including the reading arm; they are not manufacturer-verified overall measurements.
- Pipeline: image normalization → Sol custom geometry JSON → schema/semantic validation → trusted Blender builder → normalized GLB → asset and light metadata.
- This uses image-authored parts, not a predefined furniture template. The model outputs data, not executable Python.
- One cold application-level run, with no retries, no reused analysis, and no cached GLB. One sample is not an average, a reliability estimate, or a latency guarantee.

## Measured speed

Monotonic wall-clock timing started before reading/encoding the local image and stopped when the generation job became ready. The same pipeline service used by the API was called directly from a benchmark runner.

| Stage | Seconds | Boundary |
| --- | ---: | --- |
| OpenAI request | 86.2945 | HTTP request through parsed provider response; contained within preparation below |
| Complete preparation | 86.3577 | Image input, normalization, AI request, geometry/dimension validation |
| Diagnostic recipe handoff | 0.0051 | Save analysis and compile/save a reproducible recipe |
| Blender build and ready job | 1.8978 | Queue, fresh Blender process, geometry, GLB export, validation, light metadata |
| **Image → ready GLB** | **88.2606** | Sum of the three non-overlapping pipeline stages |
| Separate preview process | 31.20 | Rebuild/export same recipe, save editable Blender scene, render two 1440 × 1200 PNGs |

The preview process was timed separately using process wall time. Adding the two measured processes gives **119.46 seconds of active processing**, not one continuously measured browser-to-preview duration. Operator/tool-launch gaps between them are excluded.

Not included: prior web research, human dimension confirmation, browser upload/download/loading, API route overhead, or Cindy's room rendering. The interactive app only needs the GLB; the two offline Cycles previews are review artifacts, not required for placement.

## Exact request and usage

- Requested and returned model: `gpt-5.6-sol`.
- Reasoning effort: `high`; image detail: `high`; Responses API; strict JSON schema; `store: false`.
- Output-token ceiling: 12,000, including reasoning. Request timeout: 600 seconds. Both are test overrides; production defaults were not changed.
- Input tokens: 2,736, with 0 cached input tokens reported.
- Output tokens: 6,856, including 5,178 reasoning tokens (1,678 other output tokens).
- Total reported tokens: 9,592. No additional generation/revision request was made.
- Request configuration was checked with the OpenAI Docs skill against [official GPT-5.6 Sol documentation](https://developers.openai.com/api/docs/models/gpt-5.6-sol).

## Output and quality assessment

- Status: ready; 11 mesh parts, 7,396 triangles.
- Runtime GLB: **153,608 bytes**. The separately exported preview GLB is 153,604 bytes; filenames/root metadata differ.
- Blender: 5.2.1 LTS, locally on Dianne's laptop.
- Measured outer size: 0.5199999809 × 1.8161000013 × 0.2413000017 meters, passing the builder's 0.00001-meter tolerance; floor pivot is bottom-center.
- Technical validation verifies the chosen envelope, not the truth of estimated dimensions or exact photographic fidelity.
- Visual improvement over the earlier mini-generated sample: continuous pole, correctly upward-open top bowl, coherent curved task arm, black frame, white shades, and connected major parts.
- Remaining mismatch: the task shade appears longer/narrower, and the top bowl more conical, than the reference. Finish and hidden details remain approximate. No manual edits were made to conceal these differences.
- Technical generation: **pass**. Recognizable stylized preview: **promising**. Exact shopping-product reconstruction: **not established**.

## Lighting handoff for Cindy

The ready asset and GLB root extras contain two emitters in normalized model-local coordinates (meters, Y up), with `activation: "night"`:

| ID | Position [X, Y, Z] | Direction [X, Y, Z] |
| --- | --- | --- |
| top-light | [-0.138728, 1.728000, 0] | [0, 1, 0] |
| task-light | [0.133569, 1.407000, 0] | [0.867135, -0.498072, 0] |

Both reference bulb material `DG_warm-bulb`. Put the lights under the same placement/rotation parent as the model. Brightness, beam, and warm-white color are visualization defaults, not measured photometry. This test confirms metadata production, **not integration in Cindy's room**; the studio images do not demonstrate night-mode activation.

## Reproduce and inspect

From the repository root, with the backend key already stored locally in the ignored environment file:

```sh
DREAMGRID_OPENAI_MODEL=gpt-5.6-sol DREAMGRID_OPENAI_REASONING_EFFORT=high \
.venv/bin/python tools/test_image_pipeline.py \
  --image /path/to/product-image.png \
  --context 'Room Essentials Torchiere with Task Light Floor Lamp, black, TCIN 87291863. Target published assembled height 71.5 inches. Target lists overall width/depth 9 inches but shade diameter 9.5 inches, and does not give extended arm width: width/depth conflict, do not treat as verified overall dimensions. Product photo is reference for shape. User-approved preview envelope: estimated overall width 0.52 meters, verified height 1.8161 meters, estimated depth 0.2413 meters. These estimated width/depth values are not manufacturer verified.' \
  --size 0.52 1.8161 0.2413 --estimated-axes width depth \
  --output artifacts/sol-lamp-new-run --request-timeout 600 --max-output-tokens 12000
```

This command makes a paid API call. Use a fresh output directory per sample. `--reuse-analysis` on an existing saved analysis avoids another call for builder debugging, but must never be reported as fresh generation speed.

Local, git-ignored artifacts from this run:

- `artifacts/sol-lamp-test/result.json`: pipeline timing, dimension provenance, asset, lighting.
- `artifacts/sol-lamp-test/provider-geometry.metadata.json`: returned model, request timing, token usage.
- `artifacts/sol-lamp-test/provider-geometry.json`: exact returned geometry; `analysis.json`: parsed form.
- `artifacts/sol-lamp-test/recipe.json`: trusted-builder input.
- `artifacts/sol-lamp-test/preview/recipe-preview.png` and `recipe-top-preview.png`: inspected studio views.
- `artifacts/sol-lamp-test/preview/recipe.blend`: editable scene.
- `artifacts/sol-lamp-test/preview/validation.json`: mesh/size report.
- `artifacts/generated-models/940cb4c8df84b9c4e8d84e05d6fcebe7f0562a2531b270cc5ab0c5547311defc.glb`: actual runtime asset.

Backend asset path: `/api/v1/models/assets/940cb4c8df84b9c4e8d84e05d6fcebe7f0562a2531b270cc5ab0c5547311defc.glb`.

## Speed conclusion

About **98%** of the measured generation time was the AI request. Blender is not the bottleneck in this sample. Keep preview rendering out of the placement path and reuse completed assets. A controlled `medium`-reasoning comparison is a reasonable next experiment, but neither its speed nor quality has been measured here. Do not lower quality or claim a speedup without that comparison.

Verification after adding benchmark instrumentation: API lint and type checks passed; **43 API tests passed**, including a mocked test for timeout/token overrides and secret-free diagnostics. The backend default model and environment file were unchanged. No commit, push, or merge was made for this test.
