# Start Here: Team and Agent Handoff

## Get the same starting point

Accept the private-repository collaborator invitation before cloning. Clone
`https://github.com/diannedaian/dreamgrid.git`, open its root folder in your coding
agent, and read `AGENTS.md`.

Use Node 22.13+, pnpm 11.19.0, and Python 3.11+. macOS/Linux are supported by
the helper scripts; use WSL on Windows.

```bash
git clone https://github.com/diannedaian/dreamgrid.git
cd dreamgrid
pnpm bootstrap
pnpm dev
```

Web: `http://localhost:5173`. API docs: `http://localhost:8000/docs`.
The initial page should show a purple cube loaded from a local GLTF file and
an API-connected indicator. No sponsor credentials are needed for this check.

For an existing clone, finish or save your current work, switch to `main`, and
run `git pull --ff-only`, then create a fresh feature branch. Run bootstrap again
when dependency manifests or lockfiles change.

## Agent starting prompts

Replace the requested first task with the specific feature you want; these are
prompts for later feature work, not features implemented by this scaffold.

### Dianne

> Read AGENTS.md and docs/PROJECT_MANIFESTO.md. I am Dianne. My areas are
> apps/web/src/room/ and services/api/src/dreamgrid_api/adapters/model_generation/,
> plus boundaries/model_generation.py. Start on a new feature branch. My first
> task is a RoomShell component driven by the shared RoomSpec. Use meters, a
> centered floor, Y-up, and the existing SceneCanvas. Keep the rendering
> interface compatible with Cindy's future placement layer. Stop after this
> task, run the relevant checks, and summarize the interface for Cindy.

### Cindy

> Read AGENTS.md and docs/PROJECT_MANIFESTO.md. I am Cindy. My areas are
> apps/web/src/catalog/ and apps/web/src/interactions/. Start on a new feature
> branch. My first task is a placement component using the existing ModelAsset
> loader and shared SceneItem types. Use the local backbone cube while furniture
> assets are unfinished. Keep transforms outside the loader and expose changes
> through callbacks so the app can keep one RoomState. Do not change Dianne's
> room generation or Linda's budgeting code. Run the relevant checks and
> describe the state events Linda will consume.

### Linda

> Read AGENTS.md and docs/PROJECT_MANIFESTO.md. I am Linda. My areas are
> apps/web/src/commerce/ and services/api/src/dreamgrid_api/adapters/commerce/,
> plus boundaries/commerce.py. Start on a new feature branch. My first task is
> a pure subtotal calculation and budget display using shared Product and
> RoomState inputs. Build against fixtures first. Consume the same scene items
> Cindy edits; do not maintain a separate cart copy. Keep any later payment
> integration in the sandbox. Run the relevant checks and document the inputs
> the app shell must supply.

## Interfaces and integration

- Import data types from `@dreamgrid/contracts`.
- `SceneCanvas` is the shared renderer; Dianne supplies room geometry and lighting.
- `ModelAsset` accepts a GLB/GLTF URL. Cindy owns the surrounding placement group.
- `SceneItem.positionM` is in meters; convert `rotationYDeg` to radians at the Three.js boundary.
- Linda reads products and the same `RoomState.items`; budget totals must follow scene changes.
- Lift shared room state into the app compositor when features are integrated. Agree on one owner for edits to `src/app/App.tsx` during each integration session.
- Schema fixtures are data only. Apart from `backbone-cube.gltf`, the referenced furniture/image files have not been supplied yet.
- Python boundary dataclasses are internal adapter inputs/outputs, not duplicate HTTP contracts. A future route must translate to the shared camelCase JSON shapes explicitly.

## Ready to merge

Run `pnpm check`. A small PR should identify the owner, public interface, testing,
and whether it used a fixture or live service. Merge working slices every one to
three hours and run the first shared integration by T+4.

Repository CODEOWNERS currently knows only `@diannedaian`; add Cindy's and Linda's
actual usernames after their invitations are accepted. Placeholder usernames are
comments, not active review assignments. The scaffold includes CI configuration;
branch protection and deployment are separate repository settings.
