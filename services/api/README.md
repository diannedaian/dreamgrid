# DreamGrid API

FastAPI backend for DreamGrid. This branch includes health checks plus the
image-first GPT/Blender generation pipeline. Commerce remains a separate boundary.
See [Cindy's model-pipeline handoff](../../docs/MODEL_PIPELINE_HANDOFF.md) for setup,
endpoint contracts, supported templates, dimension confirmation, and deployment limits.

## Ownership

- Dianne owns implementations behind the model-generation boundary.
- Linda owns implementations behind the commerce boundary.
- Shared HTTP contracts must remain compatible with `packages/contracts`.

## Run locally

From the repository root (Python 3.11+):

```bash
pnpm bootstrap
pnpm dev:api
```

Then open:

- Health: <http://localhost:8000/api/v1/health>
- API docs: <http://localhost:8000/docs>

Health checks and explicit preset mode need no OpenAI credentials. Live preparation
requires a server-side `OPENAI_API_KEY`; generation needs Blender. Environment overrides go
in `services/api/.env` (use `.env.example` as a template); `dev:api` runs from that
directory. Environment variables supplied by a deployment also work.

## Validate

```bash
./scripts/test-api.sh
./scripts/lint-api.sh
./scripts/typecheck-api.sh
```

## Structure

```text
src/dreamgrid_api/
  api/v1/routes/health.py  # implemented HTTP route
  adapters/
    model_generation/      # Dianne: OpenAI/Blender/fallback implementations
    commerce/              # Linda: Visa sandbox implementation
  boundaries/              # ports owned by future adapters
  config.py                # environment-based settings
  main.py                  # FastAPI application factory
tests/
```

Add external integrations as adapters that implement a boundary protocol.
Keep SDK-specific types and credentials out of the boundary modules. Do not
add a route until the matching request/response contract is agreed upon in
`packages/contracts`.
