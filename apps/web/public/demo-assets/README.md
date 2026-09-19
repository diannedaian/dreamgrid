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
