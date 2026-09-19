# DreamGrid web app

```sh
cd apps/web
npm install
npm run dev     # http://localhost:5173
npm test        # unit tests (vitest)
npm run build   # typecheck + production build
```

Enter room width, depth, and height in feet and inches, or measure with the iPhone app
(`ios/README.md`). The room is rendered in meters (see `packages/contracts`) with a 1-inch
placement grid on the floor and both walls (dreamy blue; shown only while dragging furniture or
picking on a wall). Click a foot square on a wall for the menu: **Add window** (rectangle, arched, semicircle, oval),
**Add corner window** (one pick on each wall; wraps the corner), or **Add door**, then pick the corners.
Click an existing opening to remove it. Openings may not overlap. Both are plain holes; windows show the outside and let the sun in,
doors reach the floor and draw their inward swing arc. Hovering furniture inside a door's swing tints it
red with a warning.

- **Sidebar** (`src/catalog/`): drag catalog cards onto the floor; Paint recolors the walls; Floor swaps
  presets (wood, tile, carpet, concrete); Sun is a slider with sunrise / noon / sunset / midnight
  checkpoints (light blends between them), plus the compass heading the far wall faces (hover to highlight
  it) and the hemisphere. The sun is aimed from those, and only enters through windows.
- **Placed items**: click to select, drag to move (inch-snapped, kept inside the room), `R` rotates 90°,
  `Delete` removes. Lamps glow at sunset and midnight.
- **Share**: the whole plan (dimensions, windows, items, paint, floor, sun) is encoded in the URL. The
  Share chip copies a read-only link (`&view=1`); "Edit a copy" reopens it editable.
- **Catalog data**: `public/demo-assets/catalog.json` (`{ products, assets, keepFixtures? }` per
  `packages/contracts`) is loaded on top of the built-in fixtures. Dianne's `college-bed`, `college-desk`,
  and `college-chair` GLBs from PR #3 are wired in there. The loader (`src/interactions/models.ts`) wraps
  each GLB, re-centers it to a bottom-center pivot, auto-fits scale if it is far from the declared size, and
  strips node `extras.pivot` strings before parsing (three's GLTFLoader reserves that key for an array and
  otherwise produces NaN transforms). Lamp products register with the lamp registry automatically.
- **Add furniture** (bottom bar): paste a product link; the dev server scrapes it and asks OpenAI for a
  FurnitureSpec, built in the browser. Needs `OPENAI_API_KEY` in `apps/web/.env` (see `.env.example`); spend is
  capped per session. Details in `HANDOFF.md`.
- `?w=&d=&h=` (whole inches) in the URL builds the room directly.
- **Phone measuring, no app install**: the dev server is https by default (self-signed; `npm run dev:http`
  for plain http). Click **Measure with my phone** on the first page: it shows a short link like
  `https://10.0.0.5:5173/m` and a QR code. Scan it with the iPhone camera, accept the certificate warning. The page opens the camera
  and uses the tilt sensor as a rangefinder: choose your phone height, aim the crosshair at the floor line
  of the far wall for length and width, and the ceiling line for height. It POSTs to `/api/measurement`
  and the open desktop page imports it. A "type it instead" fallback covers denied permissions.
  Accuracy is roughly ±5%; the native ARKit app in `ios/` is the higher-accuracy option.

- `src/room/` — placeholder room shell (Dianne owns this; keep the `RoomShell` surface: `group`, `walls`, `setWindows`). Sunlight enters only through window holes; the ceiling and open sides are invisible shadow casters.
- `src/room/floors.ts`, `src/room/sun.ts` — floor presets and paint palette; sun direction from heading, hemisphere, and time.
- `src/interactions/` — camera, inch-grid snapping, wall picking and windows, model loading (`models.ts`), placement and dragging (`placement.ts`), lamps, and share-link encoding (`share.ts`).
- `src/catalog/` — catalog store, fixtures, and the sidebar.
