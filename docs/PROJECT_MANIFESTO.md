# DreamGrid Project Manifesto

Status: Source of truth for the HackMIT 2026 build  
Team: Dianne, Cindy, Linda  
Primary track: Interactive Media / Entertainment  
Hack duration: 24 hours  

## 1. Mission

DreamGrid lets a shopper see whether furniture fits their space, style, and budget before buying it.

The core experience is intentionally small:

1. Enter room dimensions and a budget.
2. See a cute, game-like 3D room.
3. Choose a catalog item or upload one product image.
4. Generate or load a scaled 3D model of that product.
5. Drag, rotate, and arrange products on a grid.
6. See the running cost and receive one budget-friendly alternative.
7. Approve a sandbox shopping plan.

The project is not a full marketplace, professional CAD tool, photorealistic renderer, or production payment system.

## 2. Product Principles

Every agent and teammate must optimize for these priorities, in order:

1. A reliable end-to-end demo.
2. A delightful and understandable interaction.
3. Honest, visible use of AI and sponsor technology.
4. Correct room scale and budget calculations.
5. Additional features only after the core demo is rehearsed.

When choosing between a broad feature and a polished core flow, choose the polished core flow.

## 3. Ownership

### Dianne: Model Generation and Room Foundation

Dianne owns the 3D foundation. This includes:

- Room creation from width, depth, and height.
- Floor, three walls, visible placement grid, lighting, and day/night state.
- Default room scale and coordinate system.
- Product-image analysis for model generation.
- The structured `FurnitureSpec` used to describe a model.
- Blender construction and GLB export.
- Model normalization, pivot placement, dimensions, orientation, and poly-count checks.
- Meshy or Tripo fallback when the Blender generator cannot represent an item.
- Cached demo models generated during the hackathon.

Dianne does not own dragging or object manipulation inside the room.

### Cindy: Shopping UI and Room Interaction

Cindy owns how users browse products and manipulate models inside Dianne's room. This includes:

- Product catalog, product cards, categories, and import-product UI.
- Adding a product model to the scene.
- Object selection and selection highlighting.
- Dragging models across the floor.
- Grid snapping.
- Rotating models in 90-degree steps.
- Deleting or returning models to the catalog.
- Keeping objects inside room boundaries.
- Basic collision or invalid-placement feedback.
- Camera orbit, pan, zoom, and interaction affordances.
- The placed-items inventory panel.

Cindy consumes the room and model contracts. Cindy does not generate room geometry or GLB files.

### Linda: Budget Intelligence and Visa Commerce

Linda owns money, recommendations, and checkout intent. This includes:

- Cart and placed-room subtotal.
- Budget, remaining-budget, and over-budget states.
- "Make this room fit my budget" recommendations.
- Ranking cheaper alternatives using price, style, category, and footprint.
- Shopping-plan summary.
- User approval and consent screen.
- Visa sandbox integration.
- Checkout-intent success, failure, and fallback states.
- Impact metrics and finance-related pitch material.

Linda consumes product and scene state. Linda does not generate models or implement 3D manipulation.

### Shared Responsibilities

All three teammates own:

- Integration testing.
- Demo rehearsal.
- Submission accuracy.
- Honest disclosure of APIs, libraries, public assets, and fallbacks.
- Keeping the public repository understandable.
- Protecting the feature freeze.

## 4. Ownership Boundary in One Sentence

Dianne creates the room and the model assets; Cindy lets users shop for, place, and manipulate those assets inside the room; Linda calculates and improves the shopping plan and connects it to Visa.

## 5. Canonical Technical Contracts

These contracts are the integration boundary. Do not change a field name or unit without agreement from all three teammates.

### Coordinate System

- All runtime geometry uses meters.
- X is room width: left and right.
- Y is vertical: floor to ceiling.
- Z is room depth: front and back.
- The floor is at `y = 0`.
- The room origin is the center of the floor.
- Every furniture model has its pivot at the bottom-center of its footprint.
- Every normalized model faces positive Z.
- The default grid size is `0.25` meters.
- User-entered feet, inches, or centimeters are converted to meters at the input boundary.

### RoomSpec

```ts
type RoomSpec = {
  widthM: number;
  depthM: number;
  heightM: number;
  gridSizeM: number;
  lightingMode: "day" | "night";
};
```

### Product

```ts
type Product = {
  id: string;
  title: string;
  category: "bed" | "desk" | "chair" | "shelf" | "lamp" | "decor";
  priceUsd: number;
  merchant: string;
  sourceUrl: string;
  imageUrl: string;
  dimensionsM: [width: number, height: number, depth: number];
  styleTags: string[];
  colorTags: string[];
  modelAssetId?: string;
};
```

### ModelAsset

```ts
type ModelAsset = {
  id: string;
  productId: string;
  glbUrl: string;
  previewUrl?: string;
  dimensionsM: [width: number, height: number, depth: number];
  pivot: "bottom-center";
  forwardAxis: "+Z";
  generationMethod: "gpt-blender" | "meshy" | "tripo" | "public-preset";
  status: "queued" | "generating" | "ready" | "failed";
  disclosure: string;
};
```

### SceneItem

```ts
type SceneItem = {
  id: string;
  productId: string;
  modelAssetId: string;
  positionM: [x: number, y: number, z: number];
  rotationYDeg: 0 | 90 | 180 | 270;
};
```

### RoomState

```ts
type RoomState = {
  room: RoomSpec;
  budgetUsd: number;
  items: SceneItem[];
};
```

## 6. Model-Generation Contract

The default generation path is constrained and testable:

1. The user supplies a clean product image.
2. Real dimensions are taken from catalog metadata or explicitly entered by the user.
3. The OpenAI API returns a schema-valid `FurnitureSpec`.
4. The specification uses a restricted vocabulary such as boxes, rounded boxes, cylinders, legs, shelves, shades, repeated parts, and materials.
5. A trusted Blender script interprets the specification.
6. Blender exports a normalized GLB.
7. Validation checks dimensions, pivot, orientation, file existence, and reasonable polygon count.
8. If the constrained generator fails, the service may call Meshy or Tripo and then normalize the result.
9. The UI must disclose which generation path produced the asset.

Agents must not execute unrestricted model-generated Python. Generated content must pass through the constrained model specification or another explicitly sandboxed and validated path.

## 7. MVP Acceptance Criteria

The MVP is complete only when all of the following work in one uninterrupted demo:

- A user can enter room dimensions and see a correctly scaled floor, grid, and three walls.
- The catalog contains at least eight products across at least four categories.
- At least three attractive models are cached and guaranteed to load.
- One product image can be transformed into a new GLB during the hackathon.
- A user can add, select, drag, snap, rotate, and delete a model.
- A model cannot silently disappear outside the room.
- The item list and subtotal update when objects are added or removed.
- The UI clearly shows whether the design is under or over budget.
- One action recommends a cheaper replacement.
- The user can approve a shopping plan through a real Visa sandbox call or an explicitly labeled fallback if sponsor access fails.
- The complete demo works with cached assets when live generation is unavailable.
- API and asset disclosures are visible in the repository or submission.

## 8. Demo Golden Path

The judged demo uses a known, rehearsed sequence:

1. Create a small dorm room.
2. Set a budget.
3. Add a cached bed and desk.
4. Upload or select a simple lamp or shelf image.
5. Show the AI-generated structured description and generation status briefly.
6. Load the resulting model into the room.
7. Drag, snap, and rotate it.
8. Exceed the budget intentionally.
9. Ask for a cheaper replacement.
10. Approve the revised shopping plan in the Visa sandbox flow.
11. Toggle night mode to end on a memorable visual.

The live-generation item must be geometrically simple. Use a lamp, shelf, stool, or nightstand. Do not depend on a blanket, beanbag, plant, or ornate sofa for the live demo.

## 9. Award Strategy

Primary targets:

- Interactive Media / Entertainment: the polished game-like 3D experience.
- Visa: personalized, budget-aware shopping plus user-approved sandbox commerce.
- OpenAI: image understanding, structured model specification, and Codex-supported development.
- Long Lake: the immediate skeptic-conversion moment of a product becoming a placeable model.
- Ramp: saving time and money through totals and cheaper substitutions.

Conditional targets:

- Cognition only if the team genuinely uses Devin and can demonstrate its contribution.
- Meta only if sharing or roommate co-creation is working and AI meaningfully improves collaboration.

Do not alter the product merely to claim an unrelated sponsor challenge.

## 10. Non-Goals Until the MVP Is Rehearsed

- Floor-plan image parsing.
- Amazon or IKEA scraping.
- A comprehensive product search engine.
- Photorealistic rendering.
- Real purchases or production payment credentials.
- Accounts and authentication.
- Persistent cloud projects.
- Multi-room homes.
- Real-time multiplayer editing.
- Voice control.
- Arbitrary recoloring followed by reverse product search.

Stretch priority after the MVP is stable:

1. Day/night lighting.
2. Shareable read-only room link.
3. Simple roommate co-creation.
4. Floor-plan parsing.

## 11. Integration Milestones

### T+1 Hour: Contracts Locked

- Shared schemas exist in one location.
- One sample `Product`, `ModelAsset`, and `RoomState` fixture exists.
- OpenAI, Blender, and Visa feasibility calls have each been attempted.
- The team knows the Visa fallback if access is delayed.

### T+4 Hours: Independent Vertical Slices

- Dianne: dimension-based room plus one Blender-exported GLB.
- Cindy: one hard-coded GLB can be selected and dragged on a snapping plane.
- Linda: a fixture room state produces correct totals and a mock approval result.

### T+8 Hours: First Full Integration

- A Dianne-generated asset loads in the room.
- Cindy's add, move, rotate, and delete actions update shared state.
- Linda's subtotal reacts to the same shared state.
- The Plume project has been created and saved.

### T+14 Hours: MVP Feature Freeze

- Golden path works end to end.
- Cached fallbacks exist.
- No new core features are accepted.

### T+20 Hours: Demo Freeze

- The app has been tested from a clean browser.
- The app survives API failure.
- The team has a backup video.
- Only visual polish, submission work, and critical bug fixes remain.

### T+23 Hours: Submission Freeze

- Plume is fully saved.
- Repository and links are accessible.
- API disclosures are accurate.
- Every teammate can present the architecture and answer questions.

## 12. Agent Working Rules

Every coding agent working on DreamGrid must follow these rules:

1. Read this document and `GITHUB_WORKFLOW.md` before proposing or changing architecture.
2. Work inside the assigned owner's subsystem unless explicitly asked to integrate elsewhere.
3. Treat the canonical contracts as stable public interfaces.
4. Use fixtures or mocks when another subsystem is unfinished.
5. Never block one owner while waiting for another owner's live implementation.
6. Add the smallest test that proves the feature's acceptance criterion.
7. Preserve the cached demo path even when adding live APIs.
8. Do not add a dependency, sponsor integration, database, or authentication system without a concrete MVP need.
9. Do not claim that the team built an API, library, model, or public asset.
10. Record meaningful Codex contributions for the OpenAI judging narrative.
11. After feature freeze, fix only demo blockers, correctness bugs, and obvious visual defects.
12. If a request conflicts with this manifesto, surface the conflict before implementing it.

## 13. Suggested Repository Boundaries

The exact framework may change, but ownership boundaries should remain recognizable:

```text
apps/web/src/room/             Dianne: room geometry, grid, lighting
apps/web/src/interactions/     Cindy: selection, dragging, rotation, camera
apps/web/src/catalog/          Cindy: catalog and import UI
apps/web/src/commerce/         Linda: budget, alternatives, approval UI
services/api/src/dreamgrid_api/adapters/model_generation/  Dianne: provider adapters
services/api/src/dreamgrid_api/adapters/commerce/          Linda: commerce adapters
services/api/src/dreamgrid_api/boundaries/                Typed provider interfaces
packages/contracts/            Shared and locked after T+1
apps/web/public/demo-assets/   Cached, disclosed demo assets
```

## 14. Definition of Done

DreamGrid is done when a judge can understand the problem in one sentence, watch a product become a correctly scaled model, arrange it naturally in a room, see the budget consequence, approve a safer shopping plan, and remember the experience afterward.

Anything that does not make that sequence more reliable, delightful, or convincing is secondary.
