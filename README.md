# DreamGrid

DreamGrid is a HackMIT 2026 project for planning a dorm room in 3D before buying furniture. It turns room dimensions and product images into a game-like room where users can arrange furniture, understand total cost, and adjust the plan to fit a budget.

This repository currently provides the shared backbone, contracts, and ownership boundaries. It intentionally does not implement the judged product features.

## Quick start

Requirements:

- Node.js 22.13+ (Node 22 LTS is recommended)
- pnpm 11
- Python 3.11+

macOS/Linux commands are shown below; Windows teammates should use WSL.

```bash
pnpm bootstrap
pnpm dev
```

Then open:

- Web client: <http://localhost:5173>
- API health: <http://localhost:8000/api/v1/health>
- API documentation: <http://localhost:8000/docs>

Run every automated check with:

```bash
pnpm check
```

If the default `python3` is older than 3.11, point bootstrap at a newer interpreter:

```bash
DREAMGRID_PYTHON=/path/to/python3.11 pnpm bootstrap
```

## Repository map

```text
apps/web/             React + TypeScript + Three.js interface
services/api/         FastAPI backend and provider boundaries
packages/contracts/   JSON Schemas, TypeScript types, and validators
fixtures/             Shared product, model, room, and generation fixtures
docs/                 Product, architecture, and collaboration decisions
```

The web client already includes a working React Three Fiber canvas and a reusable GLB/GLTF loader boundary:

```tsx
<SceneCanvas>
  <ModelAsset url={modelAsset.glbUrl} />
</SceneCanvas>
```

Room geometry and model generation remain Dianne's domain. Cindy can wrap the loaded asset in interaction-owned transforms without changing its loader. Linda can consume the shared scene and product state without depending on Three.js internals.

## Team ownership

- **Dianne:** room construction and 3D model generation
- **Cindy:** catalog UI and in-room model interaction
- **Linda:** budget intelligence and commerce integration

## Read before contributing

1. [`AGENTS.md`](AGENTS.md) routes coding agents to the correct subsystem.
2. [`docs/PROJECT_MANIFESTO.md`](docs/PROJECT_MANIFESTO.md) defines scope and ownership.
3. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) defines system boundaries.
4. [`docs/GITHUB_WORKFLOW.md`](docs/GITHUB_WORKFLOW.md) defines branch and merge practice.
5. [`docs/TEAM_HANDOFF.md`](docs/TEAM_HANDOFF.md) gives each teammate's agent a starting prompt and exact folders.

Keep `main` demoable, use short-lived branches, and preserve fixture-based fallbacks.
