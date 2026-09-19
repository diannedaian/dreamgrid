# College bed generation test

This is Dianne's first original, reproducible Blender asset. It is not a live
image-to-model API feature, and it does not change Cindy's interactions or
Linda's budget code. No catalog prices or existing product IDs were changed.

## Scale and evidence

Sources checked September 19, 2026:

- [Gonzaga furniture dimensions](https://www.gonzaga.edu/student-life/housing-dining/help-center/furniture-dimensions)
  contains the user's first photo and a
  [measurement diagram](https://www.gonzaga.edu/__data/assets/image/0020/224453/Bed-Measurements.jpg)
  labeled 85.5 inches long, 38 inches wide, and 37 inches high. We interpret these
  annotations as the model's overall bed envelope. Gonzaga notes furnishings vary.
- The standard-height photo on that page states 19 inches from the floor to the
  mattress underside. That is **not** the clear storage height below the rails.
- [MIT's residence furniture page](https://studentlife.mit.edu/policies-and-resources/furniture-in-residence-halls/)
  lists a 38 by 80 inch Twin XL. We use those mattress plan dimensions inside the
  above envelope, not an assertion that this is an exact MIT/Gonzaga furniture SKU.

| Measurement | Inches | Meters |
|---|---:|---:|
| Overall width X | 38 | 0.9652 |
| Overall height Y | 37 | 0.9398 |
| Overall depth/length Z | 85.5 | 2.1717 |
| Mattress width / length | 38 / 80 | 0.9652 / 2.032 |
| Mattress underside | 19 | 0.4826 |
| Mattress thickness — estimate | 6 | 0.1524 |

The references do not provide a manufacturer drawing. The six-inch mattress,
two-inch post sections, rail sizes, bevels, slots, bolts, and concealed support
slats are adjustable visual estimates. Wooden side rails follow the user's
second photo; the first photo has a more exposed metal support. This is a
dimensioned stylized reconstruction, not an exact SKU or certified fit guarantee.

The model has no pillow, blanket, room, baked lighting, or external texture.
The aesthetic uses honey-oak colors, softened corners, a rounded slate-navy
mattress, and graphite hardware. All materials are standard metallic-roughness
PBR colors and export to glTF. Studio lighting changes the perceived colors in
the preview; it is not baked into the model.

## Outputs and teammate handoff

- `apps/web/public/demo-assets/college-bed.glb`: committed, self-contained web asset.
- `college-bed.json`: canonical FurnitureSpec input; editable dimensions/materials.
- `college-bed.asset.json`: ModelAsset metadata using the existing shared contract.
- `artifacts/college-bed/college-bed.blend`: editable Blender scene, generated locally.
- `artifacts/college-bed/college-bed-preview.png`: product render, generated locally.
- `artifacts/college-bed/college-bed-top-preview.png`: higher-angle render, generated locally.
- `artifacts/college-bed/validation.json`: measured build report, generated locally.

The `.blend` and renders are intentionally not committed; one command reproduces
them. Geometry is original, made from primitives. No third-party mesh or texture
is included, and reference photos are not redistributed. Asset licensing follows
the team's repository licensing decision; no third-party mesh license is claimed.

Use the existing frontend loader without rescaling:

```tsx
<ModelAsset url="/demo-assets/college-bed.glb" />
```

The root is bottom-center at zero; +Y is up; +Z points toward the foot in glTF.
In Blender the equivalent is Z-up, with the foot pointing -Y. The bed is
symmetric, but head/foot mesh names preserve the intended orientation.

Cindy can wrap it in a placement-owned group. Add the matching product ID to the
real catalog when integrating; this standalone asset intentionally does not
replace the unrelated compact-platform-bed fixture or invent a shopping price.

## Rebuild and validate

From the repository root, after `pnpm bootstrap`:

```bash
bash scripts/build-college-bed.sh
pnpm test:models
```

The launcher defaults to Blender's standard macOS app path. On another system:

```bash
DREAMGRID_BLENDER=/path/to/blender bash scripts/build-college-bed.sh
```

Use `--no-render` to export/save without rendering. Tested with Blender 5.2.1 LTS.
Blender builds in a fresh background process; it does not clear a user's open
Blender project. Rendering uses CPU Cycles; the application may still need normal
OS graphics-device access when initializing.

The interpreter currently supports box, rounded-box, cylinder, and bounded
repetition. Unsupported primitives fail explicitly. There is no arbitrary-code
field, execution of generated Python, network access, or runtime provider call.
Canonical schema validation runs before Blender, then the build verifies bounds,
pivot, triangle budget, and size. A separate Three.js GLTFLoader check validates
the exported file rather than trusting only the Blender scene.

Only developer-invoked local use is supported at this stage. Before accepting
untrusted web uploads, add process-level isolation, time/memory limits, and
per-job output directories; do not expose this CLI directly as a public service.
