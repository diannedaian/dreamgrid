# Generation button integration check

Branch: `codex/connect-generation`. Tested September 19, 2026 on Dianne's laptop.

## Actual path tested

The room's **+ Add furniture** button accepted the previously supplied Target
torchiere/task-lamp PNG and specifications. It POSTed to FastAPI through the Vite
same-origin proxy. The configured analyzer was `gpt-5.6-sol`, high reasoning;
Blender was the local installed application. No Meshy, Tripo or template was used.

One fresh paid analysis completed successfully. A development reload interrupted
the review UI; subsequent submissions of the identical image/text returned the
backend's cached analysis (`usage.cached: true`, UI reported 0 seconds), not fresh
paid calls. This is therefore **not a clean end-to-end latency benchmark**.

The browser review used 52 cm width × 181.61 cm height × 24.13 cm depth. Width/depth
remain user-approved estimates; height came from the provided specifications.
Trying to build without accepting the estimates was blocked. After acceptance,
the UI showed a queued Blender job, polled it, downloaded the returned GLB, then
displayed success only after inserting it into the existing Three.js room.

Output: 136,588-byte GLB, two lamp emitters, black pole/base and white shades.
Local generated asset hash:
`16fe1c1d8193d4cc1c10ddc3934d1f845429e4488b0a9ad79dd14d8a61bc8d85`.
This test asset stays in ignored `artifacts/generated-models/`, not the public demo catalog.

## Browser checks

- Existing two rugs, cached lamp and open fridge remained present.
- New lamp appeared automatically at floor center and in the Lamps catalog.
- Dragging moved the new SceneItem; 90-degree rotation updated the room plan URL.
- Night mode used the generated bulb rig; backend coordinates/material names were present.
- Reload restored the new catalog entry, its moved/rotated placement and the original furniture.
- No browser errors or warnings were recorded for the final loaded room.

## Important limits

Image upload is still required. The optional URL only supplies best-effort
dimension context. No uploaded image is stored in browser persistence; local
catalog metadata and backend GLB files are retained separately. New generated
catalog entries are not yet shared between different browsers. The backend must
be running for GLB downloads. Model appearance and lighting are approximate.

The integration also fixes a provenance edge case: quoted text explicitly saying
“about” or “estimated” remains estimated rather than becoming a verified dimension.
