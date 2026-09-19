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

## College bed

`college-bed.glb` is Dianne's first original Blender generation test: beveled oak
frame and navy Twin XL mattress. It is 0.9652 m wide, 0.9398 m high, and 2.1717 m
long, with a bottom-center origin, glTF Y-up, and foot toward +Z.

See [`assets/specs/README.md`](../../../../../assets/specs/README.md) for exact
sources, measurement assumptions, generation disclosure, and reproduction steps.
The model is self-contained; the preview studio is excluded. This does not
replace the compact-platform-bed fixture or implement the live generation API.

## College study furniture

- `campus-chair.glb`: Campus 2 inspired blue-upholstered chair, 0.48895 W x
  0.8382 H x 0.5588 D meters.
- `dorm-desk.glb`: right-pedestal oak dorm desk, 1.0668 W x 0.762 H x 0.6096 D meters.

Both are original, self-contained Blender reconstructions with a bottom-center
origin and +Z front. See [the study-set notes](../../../../../assets/specs/STUDY_SET.md)
for sources, approved dimensions, visual estimates, and regeneration commands.
They do not alter existing catalog products or implement interactive drawers.
