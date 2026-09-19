# College chair and dorm desk

These extend Dianne's generation assets using the same beveled wood style as the
bed. They are original, offline Blender reconstructions, not manufacturer meshes
and not a completed live image-to-model API. No frontend/catalog behavior changed.

## Dimensions and sources

### Campus 2 inspired chair

Verified September 19, 2026 against the [manufacturer page](https://mitylite.com/products/chairs/campus-2-chair)
and visually inspected page 2 of its [official brochure](https://mitylite.com/wp-content/uploads/brochures/Campus_2_Chair.pdf).

- Overall: **19.25 W x 33 H x 22 D inches** = **0.48895 x 0.8382 x 0.5588 m**.
- Seat: **17.5 x 17.5 inches**, top at **18.5 inches / 0.4699 m**.
- Positive Z faces the front; the tilted backrest is at negative Z.
- Fully upholstered blue seat/back and a warm beech-colored frame follow the
  supplied photo. The open, angled sled base preserves the distinctive silhouette.

Upholstery thickness, back tilt/curvature, frame sections, joints, rocker slope,
and bolt locations are estimated from the photos. This is a simplified decorative
model, not manufacturing CAD. Do not infer safety, load rating, ergonomic fit,
or real rocking behavior from its mesh.

The wood uses a fixed offline union/smoothing pass to remove primitive seams;
its pre-operation bounding envelope is restored after simplification. Upholstery
and hardware are not rescaled, and the real GLB is separately checked in Three.js.

### Right-pedestal dorm desk

The user explicitly approved **42 W x 24 D x 30 H inches**, with drawers on the
right. Runtime width/height/depth: **1.0668 x 0.762 x 0.6096 m**.

[Lehigh Housing](https://auxiliaryservices.lehigh.edu/furniture-residence-halls)
publishes this size for a comparable older dorm desk with pedestal drawers and
a pencil drawer. It is a size reference, **not an identification of the exact
desk in the user's photos**. The user's larger photo guides the right pedestal,
three drawer fronts, recessed pulls, slab sides, and open keyboard/pencil tray.
The small pasted reference has left-side drawers; the approved version is right-side.

Top/panel thickness, tray dimensions, drawer divisions, and finger pulls are
visual estimates. Drawers and tray are static geometry, not working mechanisms.
No hutch, accessories, chair placement, or fabricated product price is included.

## Files and frontend use

| Asset | Web URL | Recipe / metadata |
|---|---|---|
| Chair | `/demo-assets/campus-chair.glb` | `campus-chair.json` / `campus-chair.asset.json` |
| Desk | `/demo-assets/dorm-desk.glb` | `dorm-desk.json` / `dorm-desk.asset.json` |

Use these with the existing ModelAsset loader at scale 1. Both use meters,
bottom-center origins, Y-up, and +Z front. Cindy owns placement transforms.
Metadata product IDs are new and intentionally not inserted into the shared
placeholder catalog; the shopping owner can add corresponding products later.

Reproduce editable Blender scenes and two previews per model:

```bash
bash scripts/build-furniture.sh campus-chair
bash scripts/build-furniture.sh dorm-desk
pnpm test:models
```

On a nonstandard Blender installation set `DREAMGRID_BLENDER=/path/to/blender`.
Use `--no-render` for geometry-only export. Artifacts are generated in
`artifacts/campus-chair/` and `artifacts/dorm-desk/`, with a `.blend`, front
three-quarter preview, higher-angle preview, and `validation.json` for each.
The committed GLBs remain below the 2 MB / 40,000-triangle asset budget.

Verified exports with Blender 5.2.1 LTS and Three.js GLTFLoader:

- Chair: 441,440 bytes, 22,984 triangles, 11 meshes.
- Desk: 199,804 bytes, 8,592 triangles, 20 meshes.
- Actual mesh bounds match the declared dimensions within 0.00001 m; the chair's
  seat width, depth, and top height are also checked on the loaded GLB.
- `pnpm check` passes (30 tests across the project, including 10 asset tests).
- The generalized builder also reproduces the original bed within its original
  size/triangle budget; the existing committed bed GLB was not replaced.

The shared builder was generalized to name and frame the selected asset instead
of always producing bed filenames. The legacy bed launcher remains supported.
No shared contract fields or dependencies were added.

All geometry is authored from primitives; no third-party mesh, texture, logo, or
reference photo is redistributed in the GLBs. Names identify visual references,
not endorsement or an official manufacturer asset. Repository licensing remains
the team's decision. Preview lighting is not baked into the models.
