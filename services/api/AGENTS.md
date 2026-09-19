# API Agent Instructions

Read the root `AGENTS.md` and project manifesto first.

## Scope

This directory is one FastAPI deployment with separate internal domains. Do not create additional deployable services during the hackathon.

## Ownership

- Dianne owns `boundaries/model_generation.py` and `adapters/model_generation/`.
- Linda owns `boundaries/commerce.py` and `adapters/commerce/`.
- Versioning, configuration, dependencies, and shared HTTP behavior are shared changes.

## Rules

- All product endpoints live below `/api/v1`.
- Keep provider SDK imports inside an adapter package.
- Boundary types must be provider-neutral and must agree with `packages/contracts`.
- Do not execute unrestricted generated Python.
- Do not initiate a real purchase; commerce implementations use sandbox intent only.
- Read credentials through settings. Never hardcode or return them.
- Tests must use fakes and cannot depend on network access, Blender, or sponsor uptime.
- Do not add a route until its request and response contract are agreed upon.

## Validate

From the repository root:

```bash
./scripts/lint-api.sh
./scripts/typecheck-api.sh
./scripts/test-api.sh
```
