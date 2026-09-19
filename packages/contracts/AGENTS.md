# Contracts Agent Guide

Scope: `packages/contracts/`

This package is shared infrastructure, not an owner's feature area. Treat its
public fields and units as locked after the T+1 integration checkpoint.

Before editing:

1. Read the root `AGENTS.md` and `docs/PROJECT_MANIFESTO.md`.
2. Identify every consumer affected: room/model generation, interaction UI,
   and budget/commerce.
3. Ask all three teammates before making a breaking contract change.

Rules:

- Keep `RoomSpec`, `Product`, `ModelAsset`, `SceneItem`, and `RoomState`
  field-for-field compatible with the manifesto.
- Keep JSON Schemas and TypeScript types synchronized in the same change.
- Update fixtures and tests whenever a public contract changes.
- Import from `@dreamgrid/contracts`; never duplicate these types elsewhere.
- Preserve meters, X/Y/Z axis meanings, bottom-center pivots, `+Z` forward,
  and quarter-turn scene rotations.
- Do not add provider-specific response objects to shared client contracts.
- Never add an executable-code escape hatch to `FurnitureSpec`.
- Use optional additive fields only when the MVP has a concrete consumer.

Run `pnpm --filter @dreamgrid/contracts test` and
`pnpm --filter @dreamgrid/contracts typecheck` before merging.
