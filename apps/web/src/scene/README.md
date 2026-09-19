# Shared scene boundary

This directory contains renderer infrastructure shared by the room and interaction
owners. Keep it small and ownership-neutral.

- `SceneCanvas` supplies the React Three Fiber canvas, camera, default lights, and failure boundary.
- `SceneLighting` provides defaults even when custom model children replace the placeholder. Dianne can override them with the canvas `lighting` prop.
- `ModelAsset` loads and clones a GLB URL without placement behavior.
- `ScenePlaceholder` loads `/demo-assets/backbone-cube.gltf` through the real asset loader and should disappear when the room lands.

Minimal integration (GLB and GLTF both work):

```tsx
import { SceneCanvas } from "./SceneCanvas";
import { ModelAsset } from "./ModelAsset";

<SceneCanvas>
  <group position={item.positionM} rotation={[0, item.rotationYDeg * Math.PI / 180, 0]}>
    <ModelAsset url={asset.glbUrl} />
  </group>
</SceneCanvas>
```

Each instance is cloned so the same cached asset can appear in multiple places.
The loader preserves the supplied pivot, orientation, and dimensions; Dianne's
pipeline must normalize those before exporting. Local assets go under
`apps/web/public/demo-assets/` and are served at `/demo-assets/`. Remote asset
URLs must allow browser access through CORS. GLTF files with external buffers or
textures need those resources hosted beside them; self-contained GLB is preferred.

Changes to this boundary should be reviewed by both Dianne and Cindy.
