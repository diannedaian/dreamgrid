# Web Agent Instructions

Read the root `AGENTS.md` and project manifesto first.

## Ownership

- Dianne owns `src/room/` and the scale/orientation assumptions consumed by `src/scene/`.
- Cindy owns `src/catalog/` and `src/interactions/`.
- Linda owns `src/commerce/`.
- `src/scene/`, app bootstrap, shared components, and API adapters are integration surfaces; coordinate changes with their consumers.

## 3D Rules

- Use React Three Fiber as the React renderer for Three.js.
- Load normalized GLB/GLTF models through the reusable scene asset component.
- Keep application transforms in `SceneItem`; do not treat mutations inside a loaded GLB scene graph as canonical state.
- Runtime units are meters. X is width, Y is vertical, and Z is depth.
- The floor is `y = 0`; model pivots are bottom-center; normalized forward is positive Z.
- Keep camera, lighting, loaders, and error/loading fallbacks composable.
- Do not put room generation or drag behavior into the generic model loader.

## UI and Data Rules

- Access the backend only through `src/lib/` adapters.
- Use `VITE_API_BASE_URL`; do not hardcode deployed URLs.
- Consume types from `@dreamgrid/contracts` instead of recreating them.
- Every live path needs an obvious fixture or cached fallback for the demo.
- Avoid global state until at least two independent consumers need it.

## Validate

From the repository root:

```bash
pnpm --filter @dreamgrid/web lint
pnpm --filter @dreamgrid/web typecheck
pnpm --filter @dreamgrid/web test
pnpm --filter @dreamgrid/web build
```
