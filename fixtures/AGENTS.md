# Fixture Agent Guide

Scope: `fixtures/`

Fixtures are stable substitutes for unfinished subsystems. They must remain
valid against `packages/contracts/schemas/` and must not depend on live APIs.

- Keep IDs stable unless all consumers update together.
- Use meters for all dimensions and positions.
- Keep scene positions aligned to the declared grid.
- Keep product, model-asset, and scene-item references consistent.
- Placeholder asset paths do not prove that an asset exists.
- Do not describe a fixture as a real API result or completed generated asset.
- Record truthful final asset credits and disclosures before submission.
