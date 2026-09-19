# DreamGrid web app

Minimal React, TypeScript, Vite, and React Three Fiber foundation for the shared
DreamGrid experience. This package intentionally contains no judged product
features yet.

## Run it

From the repository root:

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local
pnpm --filter @dreamgrid/web dev
```

The web app runs at `http://localhost:5173`. The default API origin is
`http://localhost:8000`.

Useful package commands:

```bash
pnpm --filter @dreamgrid/web typecheck
pnpm --filter @dreamgrid/web lint
pnpm --filter @dreamgrid/web test
pnpm --filter @dreamgrid/web build
```

## Stable integration seams

- `GET /api/v1/health` must return JSON containing a string `status` field. The shell
  reports reachability but remains usable when the backend is offline.
- `src/scene/SceneCanvas.tsx` is the shared renderer boundary.
- `src/scene/ModelAsset.tsx` accepts a public or remote GLB URL. It owns loading
  and cloning only; it deliberately does not own position or interaction state.
- Canonical `RoomSpec`, `ModelAsset`, and `SceneItem` types come from
  `@dreamgrid/contracts`; feature code must not redefine them locally.
- Browser-visible settings belong in `VITE_*` variables. Never expose a secret in
  one of these variables.

Example asset handoff:

```tsx
<SceneCanvas>
  <ModelAsset url={modelAsset.glbUrl} />
</SceneCanvas>
```

Dianne supplies room content and normalized GLB URLs. Cindy wraps `ModelAsset`
inside interaction-owned groups for selection, movement, snapping, and rotation.
Linda consumes shared scene/product state outside the renderer.

## Ownership folders

```text
src/room/          Dianne: room geometry, grid, lighting
src/interactions/  Cindy: selection and object manipulation
src/catalog/       Cindy: shopping and import UI
src/commerce/      Linda: budget and approval UI
src/scene/         Shared renderer + asset-loading boundary
src/lib/           Ownership-neutral configuration/API utilities
```

Read the repository manifesto and GitHub workflow before changing an interface.
WebGL components should remain thin; test state and calculations outside the
canvas whenever possible.
