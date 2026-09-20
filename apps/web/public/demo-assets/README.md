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

## DCI Campus four-drawer chest (September 19, 2026)

- `campus-drawer-chest.glb`: Dianne's final supplied default model from
  `outputs/drawer_chest/campus_4_drawer_chest.glb`. This is an offline Blender
  visualization, not an official manufacturer mesh or a live pipeline result.
  No third-party mesh license was supplied; the source `.blend` and preview
  renders remain outside the repository.
- [DCI Campus 4 Drawer Chest](https://dcifurn.com/campus-4-drawer-chest/): the
  source notes select the published 30 W × 18 D × 38 H inch option. Catalog
  dimensions use **width, height, depth**: `[0.762, 0.9652, 0.4572]` meters.
  The GLB is already Y-up/+Z-front; only the viewer's normal bottom-centering is
  needed. Do not apply the Blender source's Z-up/-Y-front convention again.
- Oak texture: **Oak Veneer 01**, Jenelle van Heerden / Poly Haven,
  [CC0](https://polyhaven.com/a/oak_veneer_01), as credited in the supplied notes.
  Both color and normal maps remain embedded; there are no external asset requests.
- Optimized with glTF Transform 4.5.0: `optimize --compress meshopt
  --texture-compress auto --texture-size 1024 --simplify false --palette false
  --flatten false --join false --instance false`. Transfer size: **294,820 bytes**
  (from 5.81 MB). Geometry is not simplified; duplicate meshes share geometry,
  and the four named drawer parent groups are preserved. The texture reduction
  is for browser delivery; the supplied originals are unchanged.
- Appears under the existing Misc category with the manufacturer shopping link.
  Price was not supplied: `price-not-provided` excludes it from known-price totals
  and recommendations. Product price displays remain blank, never $0 or a missing-price label.
- Shown closed; this addition does not implement drawer controls. Drawer boxes
  and slide hardware are approximate visual details, not construction drawings.

## Chenille queen bed (September 20, 2026)

- `chenille-queen-bed.glb`: the styled version from Dianne's supplied
  `artifacts/chenille-queen-bed/queen_chenille_bed_styled.glb`. Original offline
  Blender reconstruction from user reference photos and a dimension diagram;
  not an official retailer/manufacturer mesh. Fabric, wood-grain and normal
  textures were generated locally by the supplied builder, not downloaded assets.
  No third-party mesh license is claimed.
- Shopping link: the user-supplied Bed Bath & Beyond Christopher Knight Home
  listing, product **44304387**, retained on the catalog product. No price was
  supplied or verified, so the UI leaves the price blank and budget math excludes it.
- Retail frame W/H/D is **67.5 × 35 × 88 inches**, or
  `[1.7145, 0.889, 2.2352]` meters. The draped throw increases the styled model's
  width to **1.77497673 m**; product and asset dimensions use that full preview
  envelope so no geometry is shrunk to fit the frame dimensions.
- Mattress, bedding and cushions are decorative styling, not part of the linked
  retail frame. Hidden construction, slats, trim and fabric weave are estimates.
- Already meters, Y-up, bottom-center, with the footboard facing +Z. Meshopt
  compression with glTF Transform **4.5.0** reduced the GLB from 3.91 MB to about
  3.11 MB. No texture recompression or mesh simplification; material names and
  hierarchy retained (`--palette false --flatten false --join false --instance false`).
  All images remain embedded; no studio lights or cameras are included. Source
  renders, Blender files and the bare-frame variant remain in ignored artifacts.
- Added as `chenille-queen-bed` / `asset-chenille-queen-bed` under Beds, alongside
  the college bed. Normal placement, rotation, saved layouts and sharing apply.

## Green velvet wall mirror (`green-velvet-mirror.glb`)

- User-supplied offline Blender reconstruction of the Wayfair Mercer41 irregular
  velvet-wrapped wall mirror; not a manufacturer mesh. Size **28 × 20 in** confirmed
  from the listing (`[0.508, 0.7112, 0.03556]` m); depth, backing and hardware are
  estimates. The contour is hand-traced from a perspective photo.
- The glass is a fully metallic, near-zero-roughness material with no baked
  reflection. `models.ts` assigns a tiny procedural gradient cube map to such
  materials only, so it reads as glass instead of black; no scene-wide environment
  map is added and other models are unaffected.
- Tagged `mirror` / `wall-mounted`: `PlacementController` hangs it flat on the nearer
  wall at eye level (centre ≈1.5 m), facing into the room; drag along the wall, ↑/↓ to
  move up and down, and Rotate hops it to the other wall. Under Decor, unpriced.
- 1.41 MB as supplied (glTF Transform was not available offline; 26.9k triangles,
  two embedded images).

## Prisco Olive rug (`prisco-olive-rug.glb`)

- User-supplied offline Blender model of the Bungalow Rose Premium Machine Washable
  Prisco Olive rug from a product screenshot; not a manufacturer print file.
  **30 × 46 in** confirmed (`[0.762, 0.006, 1.1684]` m); 6 mm thickness is an
  estimate and the cropped lower corners of the pattern are extrapolated.
- Floor-only like the other rugs (never snaps onto desks, never raised). Under Decor,
  unpriced. 2.52 MB as supplied; 28.7k triangles, two embedded images.

## Green bouclé lounge chair (`green-boucle-lounge-chair.glb`)

- User-supplied offline Blender model from lifestyle and dimension photographs.
  Width **49.21 in** and height **27.17 in** confirmed; round depth assumed equal to
  the width (`[1.249934, 0.690118, 1.249934]` m). Seat height, cushion diameter and
  the hidden base are estimates; the looped bouclé textures are original procedural
  artwork. Under Chairs, unpriced. 2.15 MB as supplied; 28.5k triangles.

## Category notes

- The bottom bar shows **Desks** and **Shelves** as separate columns.
  `Catalog.categoryOf` files shelf-like titles (shoe stack / rack / organizer,
  bookshelf, bookcase, shelving, cube storage) under Shelves regardless of the
  category the analyzer assigned, so generated storage pieces land in the right
  column without editing saved data.
