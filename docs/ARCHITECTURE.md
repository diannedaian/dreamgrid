# DreamGrid Backbone Architecture

Status: Backbone history plus current generation integration
Scope: See `apps/web/HANDOFF.md` for the current vanilla TypeScript/Three.js UI.

## Current integration (September 19)

The React backbone described below was replaced by Cindy's vanilla Three.js room.
The current live path is image upload → same-origin `/api/v1/models/prepare` →
Sol custom geometry → user size confirmation → `/generate` → poll `/jobs/{id}` →
Blender-exported GLB → `PlacementController.add`. Vite's `/api/v1` proxy reaches
FastAPI on port 8000; shop and phone endpoints still run in Vite. No generated
Python is executed. Product/SceneItem fields remain compatible; shared types are
re-exported from `packages/contracts/src` through its root compatibility entry.
The API and browser have separate caches; local generated entries are not yet
portable across browsers. See `docs/MODEL_PIPELINE_HANDOFF.md` for backend limits.

The remaining sections record the original infrastructure design, not a claim
that the app still uses React or that generation is unimplemented.

## System Shape

```text
Product catalog / room controls / budget UI
                    |
             apps/web (React)
                    |
       packages/contracts + fixtures
                    |
         services/api (FastAPI /api/v1)
             /                       \
 model-generation boundary      commerce boundary
 OpenAI -> Blender -> GLB        budget -> Visa sandbox
```

The browser and backend share data contracts, not implementation details. The backend can replace a live provider with a fixture without changing the frontend.

## Frontend

`apps/web` is a Vite React TypeScript application.

- `src/scene/` owns reusable Three.js rendering primitives such as the canvas, camera, lights, and GLB asset loader.
- `src/room/` is Dianne's room geometry, grid, and lighting domain.
- `src/interactions/` is Cindy's selection, dragging, snapping, rotation, and camera interaction domain.
- `src/catalog/` is Cindy's product browsing and import domain.
- `src/commerce/` is Linda's budget, recommendation, and approval domain.
- `src/lib/` contains small cross-cutting adapters such as API configuration.

React Three Fiber is the React renderer for Three.js. A model enters the scene as a URL plus the canonical `ModelAsset` metadata. Dragging logic operates on a `SceneItem`; it must not mutate the loaded GLB hierarchy as application state.

## Backend

`services/api` is one FastAPI service during the hackathon.

- Versioned HTTP routes live under `/api/v1`.
- Route handlers validate and translate requests.
- Provider-specific code belongs behind boundary protocols or adapters.
- Model generation and commerce remain separate modules even though they deploy together.
- A health route is the only implemented backbone endpoint.

Do not split this into independently deployed microservices during the hackathon.

## Contracts

`packages/contracts` owns canonical JSON Schemas, TypeScript types, validators, and shared fixtures for:

- `RoomSpec`
- `Product`
- `ModelAsset`
- `SceneItem`
- `RoomState`

Contract changes require agreement from the consumers. Additive optional fields are preferred. A breaking change must update fixtures, validators, frontend use, backend translation, and documentation together.

## Runtime Defaults

| Concern | Default |
|---|---|
| Web URL | `http://localhost:5173` |
| API URL | `http://localhost:8000` |
| API prefix | `/api/v1` |
| Web API variable | `VITE_API_BASE_URL` |
| Geometry unit | meters |
| Model transport | GLB/GLTF URL |
| Demo resilience | cached fixtures and assets |

## Deliberately Missing

- Authentication and accounts
- Database or migrations
- Production checkout
- Marketplace scraping
- Background job infrastructure
- Cloud deployment configuration
- Real model-generation implementation
- Drag-and-drop behavior
- Room construction behavior

These are absent so agents can add only the pieces required by the rehearsed MVP.
