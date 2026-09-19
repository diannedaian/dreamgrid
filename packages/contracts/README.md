# DreamGrid Contracts

This package is the locked integration boundary between the room/model pipeline,
the shopping and interaction UI, and the budget/commerce pipeline. Read
`docs/PROJECT_MANIFESTO.md` before changing it.

## Invariants

- Geometry is measured in meters at runtime.
- Coordinates are X = width, Y = vertical, Z = depth.
- The floor is `y = 0`; the room origin is the center of the floor.
- Normalized furniture pivots at the bottom-center and faces `+Z`.
- Scene rotations are limited to `0`, `90`, `180`, or `270` degrees.
- User-facing units are converted before data enters these contracts.
- Undeclared JSON fields are rejected to catch integration typos early.

The core TypeScript types intentionally match the manifesto field-for-field:
`RoomSpec`, `Product`, `ModelAsset`, `SceneItem`, and `RoomState`.

## Model generation safety boundary

`FurnitureSpec` is the only model-produced description that may reach the
trusted Blender interpreter. It describes bounded declarative parts and
materials. It cannot contain Python, JavaScript, shell commands, Blender API
calls, file paths, URLs, or arbitrary operations. A caller must validate the
spec before passing it to Blender.

The trusted interpreter remains responsible for enforcing dimensions, pivot,
orientation, file output, and polygon-count limits. Meshy and Tripo outputs
must be normalized to `ModelAsset` before the web app sees them.

## Usage

```ts
import {
  assertValidContract,
  validateRoomState,
  type RoomState,
} from "@dreamgrid/contracts";

const candidate: unknown = JSON.parse(payload);
assertValidContract("RoomState", validateRoomState, candidate);

// candidate is now narrowed to RoomState.
const roomState: RoomState = candidate;
```

JSON Schemas are available under `schemas/` and through package subpaths such
as `@dreamgrid/contracts/schemas/room-state`.

## Change rule

All three teammates must agree before changing a core field, enum, unit, axis,
or semantic meaning. Additive changes still require fixtures and validation
tests. Never copy these types into another package; import them here.
