# apps/web — agent notes

This app is the vanilla TypeScript + three.js room planner (Cindy's subsystem). Start with
[`HANDOFF.md`](./HANDOFF.md) for architecture, conventions, integration points, and how to verify.

- `npm install && npm run dev` (https, self-signed) or `npm run dev:http`.
- `npm test` (vitest) and `npm run build` (typecheck + Vite build) must stay green.
- Ownership: `src/interactions/`, `src/catalog/` are Cindy's; `src/room/` is a placeholder Dianne may replace
  as long as the `RoomShell` surface stays; `src/commerce/` is reserved for Linda.
- Shopping OpenAI calls live in `server/*.mjs` behind their session budget cap. Generation uses the
  FastAPI Sol adapter in `services/api` with a separate call cap; never put keys in the browser.
  `+ Add furniture` and shop-card imports share the image/size-review → Blender GLB flow.
  Test paid calls sparingly; unit tests never call the API.
