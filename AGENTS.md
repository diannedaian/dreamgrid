# DreamGrid Agent Guide

This file is the routing layer for every coding agent in this repository.

## Read Before Editing

1. Read `docs/PROJECT_MANIFESTO.md` for product scope and ownership.
2. Read `docs/ARCHITECTURE.md` for system boundaries and runtime contracts.
3. Read `docs/GITHUB_WORKFLOW.md` for branch, test, and merge rules.
4. Read the nearest nested `AGENTS.md` before changing a subsystem.

If instructions conflict, the root manifesto and explicit user request win. Surface a contract conflict before implementing it.

## Repository Map

```text
apps/web/                  React, TypeScript, and Three.js client
services/api/              FastAPI orchestration and external-service boundaries
packages/contracts/        Canonical shared schemas and TypeScript types
fixtures/                  Shared cross-system sample data
apps/web/public/demo-assets/ Curated, disclosed demo GLB assets
docs/                      Architecture, ownership, and workflow decisions
```

## Ownership

- **Dianne:** `apps/web/src/room/`, model display assumptions, and `services/api` model-generation boundaries.
- **Cindy:** `apps/web/src/catalog/` and `apps/web/src/interactions/`.
- **Linda:** `apps/web/src/commerce/` and `services/api` commerce boundaries.
- **Shared:** `packages/contracts/`, app bootstrap, CI, and deployment. Do not change shared contracts silently.

Ownership identifies who decides behavior. It does not prevent teammates from reviewing, testing, or helping one another.

## Stable Integration Rules

- Geometry uses meters; X is width, Y is vertical, Z is depth.
- Model pivots are bottom-center and normalized models face positive Z.
- The web client consumes GLB/GLTF assets by URL. It does not know how they were generated.
- The API exposes versioned routes under `/api/v1`.
- External providers live behind typed boundaries. Route handlers must not contain direct OpenAI, Blender, Meshy, Tripo, Visa, Amazon, or IKEA calls.
- `packages/contracts` is the source of truth for client-facing data shapes.
- Fixtures substitute for unfinished services so one teammate never blocks another.
- Never commit secrets or real payment credentials.

## Commands

```bash
pnpm bootstrap   # install JavaScript and Python development dependencies
pnpm dev         # run the web client and API together
pnpm check       # lint, type-check, test, and build everything
```

Web: `http://localhost:5173`
API: `http://localhost:8000`
API docs: `http://localhost:8000/docs`

## Change Discipline

- Work on one short-lived branch and one capability at a time.
- Modify only your assigned subsystem unless integration explicitly requires more.
- Prefer an adapter, fixture, or interface over importing another owner's implementation.
- Do not introduce authentication, a database, scraping, queues, microservices, or deployment infrastructure without an MVP requirement.
- Keep the cached demo path working when live providers fail.
- Add the smallest test proving the boundary you changed.
- Update the relevant README or architecture note when a public interface changes.

## Definition of Ready to Merge

- `pnpm check` passes, or the pull request records the exact unavailable check and reason.
- No secrets, generated dependency folders, Blender caches, or large raw assets are staged.
- Another subsystem can consume the change without undocumented assumptions.
- The pull request states whether it uses a fixture, fallback, or live integration.
