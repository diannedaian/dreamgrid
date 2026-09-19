# DreamGrid API

Minimal FastAPI backbone for DreamGrid. It currently exposes only a health
check and defines typed boundaries for future model-generation and commerce
adapters. It does not call OpenAI, Blender, Meshy, Tripo, Visa, or any other
external service.

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

No credentials are needed for the backbone. Optional API environment overrides go
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
