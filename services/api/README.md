# DreamGrid API

FastAPI backend for DreamGrid. This branch includes health checks plus the
image-first GPT/Blender generation pipeline. Commerce remains a separate boundary.
See [Cindy's model-pipeline handoff](../../docs/MODEL_PIPELINE_HANDOFF.md) for setup,
endpoint contracts, custom geometry, lamp lighting, dimension confirmation, and deployment limits.

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

Defaults: `gpt-5.6-sol`, high reasoning, 12,000 maximum output tokens (including
reasoning), 600-second provider timeout. Existing local `.env` overrides must be
updated from the earlier mini settings; see `.env.example`. No automatic paid retries.
Live generation includes plant/decor. The optional product URL supplies dimension
context only; an uploaded image is still required.

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
