# apps/web — agent notes

This app is the vanilla TypeScript + three.js room planner (Cindy's subsystem). Start with
[`HANDOFF.md`](./HANDOFF.md) for architecture, conventions, integration points, and how to verify.

- `npm install && npm run dev` (https, self-signed) or `npm run dev:http`.
- `npm test` (vitest) and `npm run build` (typecheck + Vite build) must stay green.
- Ownership: `src/interactions/`, `src/catalog/` are Cindy's; `src/room/` is a placeholder Dianne may replace
  as long as the `RoomShell` surface stays; `src/commerce/` is reserved for Linda.
- OpenAI is only reached from `server/*.mjs` behind the session budget cap; the ★ shopping agent and the search
  fallback cost ~1¢ per call (web search tool), imports ~0.1¢. Test them sparingly; unit tests never call the API.
