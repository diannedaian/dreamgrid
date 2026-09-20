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
- Commerce integration is documented in `src/commerce/README.md`. Run `pnpm check`
  at the repository root. `node tools/commerce-smoke.mjs` (from the root, with a
  local Vite server on 127.0.0.1:5175 and an installed Playwright module/Chrome)
  exercises sourcing through generation, swap/undo, approval, list/share and reload
  with mocked paid endpoints and a real cached GLB. Set `DREAMGRID_PLAYWRIGHT` to an
  external module path when needed; no extra project dependency is required.
- Catalog card preference: photo, product name and known price only; no dimensions
  on cards. Missing prices render blank, never $0 or a “price unavailable” label.
  Keep unknown-price tags and incomplete-budget accounting intact.
- Visual direction (from the collov.ai reference): Inter for UI text, an italic
  "Instrument Serif" accent for headlines (`--display`), white sheets with 28px radii,
  pill buttons in `--ink`, minimal copy. Google Fonts are loaded with system fallbacks;
  never block the app on them. The generation panel has no legal-style checkboxes.
- Chrome controls (top-right toolbar, view switcher, item tools, wall menu) are frosted
  white pills with inline stroke SVG icons (Lucide-style, 1.8px, round caps), never
  Unicode glyphs or bare underlined text. Toolbar buttons keep their icon: change text via
  the `.lbl` span, not `textContent`. Active state = `--ink` fill with white text.
- Rugs, carpets and floor mats are always at `y = 0`: no surface snapping or
  raising, including against walls and when restoring saved placements. Identify
  them by title/category/tags, not just thinness; small trays and other decor can
  still snap onto desks along with plants and table lamps.
