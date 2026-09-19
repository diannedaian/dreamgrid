# Curated demo model assets

Place only the small, compressed GLB files required for the guaranteed demo in
this directory. Vite serves a file named `desk.glb` here as
`/demo-assets/desk.glb`.

For every asset added, document its source, license, generation method, and any
normalization performed. All assets must use meters, a bottom-center pivot, and
positive Z as forward, as defined in the project manifesto.

Do not store Blender caches, raw generation experiments, or uncompressed source
files here.

## Included infrastructure fixture

`backbone-cube.gltf` is a locally authored 1-meter unit cube used to verify the
real model loader. It has a bottom-center pivot, embedded geometry, and no remote
resources. It is a technical test asset, not AI-generated furniture. The catalog
fixture URLs remain placeholders until Dianne supplies the corresponding assets.

## Fluffy rugs (September 19, 2026)

- `cloud-checker-rug.glb`: aqua/vanilla rectangular rug, nominal backing 30 × 46 in
  (0.762 × 1.1684 m). User-supplied price: $58.99; Orren Ellis Wayfair link in catalog.
- `aqua-halo-rug.glb`: aqua/seafoam/vanilla round rug, nominal backing 36 in diameter
  (0.9144 m). User-supplied price: $46.99; Highland Dunes Wayfair link in catalog.
- Source: Dianne's supplied `outputs/rugs/` GLBs from the separate Blender modeling
  task. These are user-provided offline assets, not API-generated in this branch or
  official retailer meshes. No third-party mesh license was supplied; do not claim
  one. Source Blender files and renders remain outside this repository.
- Portable GLBs are already Y-up/meters (the `.blend` originals are Z-up). Models
  rest at floor level; Cindy's existing loader centers their slightly uneven fuzzy
  bounds. Pile reaches about 0.05 m, with fibers extending ~1–2 cm beyond nominal
  backing edges. Catalog footprint is the supplied nominal size, not each fiber tip.
- Compressed using glTF Transform 4.5.0 `optimize --compress meshopt
  --texture-compress false --simplify false --palette false`. Approximate transfer
  sizes: 8.22 MB and 6.61 MB (from 46.26 MB and 34.60 MB). Colors and detailed strand
  geometry retained; the existing Meshopt decoder loads both. These remain dense
  meshes (~1.68 M and 1.34 M triangles); further web LOD work is separate.
- Prices and links were supplied by Dianne, not independently live-verified. Both
  appear under Decor; existing add, drag, rotate and share behavior is reused.
- Existing box-based collision logic may flag a rug underneath furniture as an
  overlap; rug-layer semantics are deferred to the later integration pass.

## Torchiere + task lamp (September 19, 2026)

- `torchiere-task-lamp.glb`: Dianne-approved cached Sol → Blender reconstruction
  from the generation branch's lamp test (153,608 bytes, 11 meshes). This is an
  original generated mesh, not a downloaded manufacturer asset; no third-party
  mesh license is asserted. Raw Blender files and generation logs are not bundled.
- Reference: [Target Room Essentials, black, TCIN 87291863](https://www.target.com/p/-/A-87922469?preselect=87291863).
  The listing showed $20, bulbs not included, when checked September 19, 2026.
  This catalog price is a snapshot, not a live price service.
- Width/height/depth: 0.52 × 1.8161 × 0.2413 m. Only the 71.5-inch height is
  verified; width includes the reading arm and width/depth remain user-approved
  visual estimates. These are not the retailer's stated base footprint.
- `dreamgridLighting` in GLB extras retains both image-inferred bulb positions
  and beam directions in final exported model space. `models.ts` promotes this
  to the glTF scene; `lamps.ts` attaches two lights there, so loader normalization,
  placement and rotation also transform the lights and their targets. Brightness,
  color and beam angle are illustrative defaults, not photometric predictions.
  The viewer scales metadata intensity by 0.05 to match Cindy's artistic exposure
  and bloom (40 cd metadata becomes intensity 2); source metadata is unchanged.
- Only the named bulb materials glow, not the black frame. Existing fixture lamps
  retain their fallback light. This connects one cached asset to night mode; it
  does not merge or activate the live generation backend.

## Whirlpool mini fridge (September 19, 2026)

- `mini-fridge.glb`: Dianne-supplied offline Blender model from `outputs/mini_fridge/`,
  with 111 meshes, cabinet interior and one hinged door hierarchy (1.81 MB). This
  is not an official manufacturer mesh; no third-party mesh license was supplied.
  Blender source files and render PNGs remain outside this repository.
- Correct listing: [Lowe's Whirlpool 4.3-cu-ft fridge](https://www.lowes.com/pd/Whirlpool-4-3-cu-ft-Counter-Depth-Freestanding-Compact-Refrigerator-black-stainless-steel-ENERGY-STAR/1000319705).
  The initial Target 3.3-cu-ft link was corrected by Dianne; no Target resizing is
  retained. Closed W/H/D: 0.504952 × 0.835914 × 0.559054 m (19.88 × 32.91 × 22.01 in),
  consistent with the source notes and corrected listing.
- $128.99 is Dianne's approved catalog price (September 19, 2026); the Lowe's page
  did not expose a current price, so this is not a verified live retailer quote.
- The GLB is already meters/Y-up/+Z-front. Keep its hierarchy intact: the named
  `DOOR PIVOT` carries the door, badge, handle, seals and storage bins. The viewer
  centers the closed asset once and rotates only this pivot by +110° around Y.
  Reopening/closing restores the same base rotation without cumulative drift.
- Viewer compatibility: the brushed-metal material lacks UV/tangent attributes;
  anisotropy is disabled in the loader because its invalid pixels blanked the
  bloom-composited room. Geometry, base colors and glass transmission are retained.
- Interior details and door opening are illustrative. Collision and room boundary
  checks still use the closed cabinet; an open door may overlap nearby furniture.
- Reuses `p-mini-fridge` / `m-mini-fridge` so saved rooms load this asset instead
  of the old box. The five screenshot placeholders are hidden from browsing;
  their underlying fixtures remain available only for legacy saved placements.
