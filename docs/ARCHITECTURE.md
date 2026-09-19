# DreamGrid Backbone Architecture

Status: Shared implementation map
Scope: Shared backbone plus the generation branch's image-first model boundary

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
- Health routes and the image-first model endpoints are implemented on this branch.

Generation-branch update: `/api/v1/models/prepare`, `/generate`, `/jobs/{id}`, and
`/assets/{hash}.glb` now implement the agreed image-first laptop pipeline. See
[MODEL_PIPELINE_HANDOFF.md](MODEL_PIPELINE_HANDOFF.md). It uses a bounded in-process
worker and local artifact cache, not a broker, database, or separately deployed service.
Sol (`gpt-5.6-sol`, high reasoning) authors image-specific declarative geometry,
including plant/decor; a trusted Blender interpreter exports the confirmed envelope.
`ModelAsset` gains optional model-local `lighting` metadata for room night mode.
Product/SceneItem/room shapes are unchanged. Import/job envelopes and estimate-axis
provenance are defined in `model-pipeline.schema.json`. See the handoff for limits.

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
- Automatic URL-to-image import (the current pipeline requires an uploaded image)
- Drag-and-drop behavior
- Room construction behavior

These are absent so agents can add only the pieces required by the rehearsed MVP.
