// Wall-local coordinates. Cindy owns this (interactions).
// u runs along the wall from its left edge, v runs up from the floor. Both in meters.
import { Vector3 } from "three";
import type { RoomSpec } from "@contracts";
import { INCH_M } from "./units";

export type WallSurface = "back-wall" | "left-wall";

export function toWallUV(surface: WallSurface, p: Vector3, room: RoomSpec): [u: number, v: number] {
  return surface === "back-wall" ? [p.x + room.widthM / 2, p.y] : [p.z + room.depthM / 2, p.y];
}

/** World position for a wall-local point, pushed `out` meters off the wall surface into the room. */
export function fromWallUV(surface: WallSurface, u: number, v: number, room: RoomSpec, out = 0): Vector3 {
  return surface === "back-wall"
    ? new Vector3(-room.widthM / 2 + u, v, -room.depthM / 2 + out)
    : new Vector3(-room.widthM / 2 + out, v, -room.depthM / 2 + u);
}

export function wallLength(surface: WallSurface, room: RoomSpec): number {
  return surface === "back-wall" ? room.widthM : room.depthM;
}

/** Rotation about Y that turns a +Z-facing plane to face into the room from this wall. */
export function wallYaw(surface: WallSurface): number {
  return surface === "back-wall" ? 0 : Math.PI / 2;
}

export type Cell = { i: number; j: number }; // cell indices along u and v

export function cellAt(u: number, v: number, cellM: number): Cell {
  return { i: Math.floor(u / cellM + 1e-9), j: Math.floor(v / cellM + 1e-9) };
}

export function sameCell(a: Cell, b: Cell): boolean {
  return a.i === b.i && a.j === b.j;
}

export type WindowSpec = {
  surface: WallSurface;
  uM: number; // left edge along the wall
  vM: number; // bottom edge above the floor
  widthM: number;
  heightM: number;
  /** A door is a hole that also swings inward; windows are the default. */
  kind?: "window" | "door";
};

/** Do two openings on the same wall overlap (touching edges are fine)? */
export function openingsOverlap(a: WindowSpec, b: WindowSpec): boolean {
  if (a.surface !== b.surface) return false;
  const eps = 1e-6;
  return a.uM < b.uM + b.widthM - eps && b.uM < a.uM + a.widthM - eps && a.vM < b.vM + b.heightM - eps && b.vM < a.vM + a.heightM - eps;
}

/** Quarter-disc a door sweeps when it opens into the room (hinge on the left edge as seen from inside). */
export type DoorArc = { cx: number; cz: number; r: number; sx: 1 | -1; sz: 1 | -1 };

export function doorArc(spec: WindowSpec, room: RoomSpec): DoorArc {
  const r = spec.widthM;
  if (spec.surface === "back-wall") {
    // hinge at the door's left edge on the back wall; sweeps toward +X and into the room (+Z)
    return { cx: -room.widthM / 2 + spec.uM, cz: -room.depthM / 2, r, sx: 1, sz: 1 };
  }
  // left wall: u runs from the back corner toward the front; sweeps toward +Z and into the room (+X)
  return { cx: -room.widthM / 2, cz: -room.depthM / 2 + spec.uM, r, sx: 1, sz: 1 };
}

/** Does an axis-aligned floor footprint (center + size) overlap the door's swing? Exact for rect ∩ quarter-disc. */
export function footprintBlocksDoor(cx: number, cz: number, w: number, d: number, arc: DoorArc): boolean {
  // Clip the rectangle to the quadrant the door sweeps through.
  let x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
  if (arc.sx > 0) x0 = Math.max(x0, arc.cx); else x1 = Math.min(x1, arc.cx);
  if (arc.sz > 0) z0 = Math.max(z0, arc.cz); else z1 = Math.min(z1, arc.cz);
  if (x0 >= x1 || z0 >= z1) return false;
  // Closest point of the clipped rectangle to the hinge.
  const px = Math.min(Math.max(arc.cx, x0), x1), pz = Math.min(Math.max(arc.cz, z0), z1);
  return (px - arc.cx) ** 2 + (pz - arc.cz) ** 2 < arc.r ** 2;
}

/** The smallest inch-aligned rectangle covering a set of inch cells (two opposite corners is enough). */
export function windowFromCells(surface: WallSurface, cells: Cell[], kind: "window" | "door" = "window"): WindowSpec {
  const is = cells.map((c) => c.i);
  const js = cells.map((c) => c.j);
  const i0 = Math.min(...is);
  const j0 = kind === "door" ? 0 : Math.min(...js); // doors always reach the floor
  const i1 = Math.max(...is) + 1;
  const j1 = Math.max(...js) + 1;
  return { surface, uM: i0 * INCH_M, vM: j0 * INCH_M, widthM: (i1 - i0) * INCH_M, heightM: (j1 - j0) * INCH_M, ...(kind === "door" ? { kind } : {}) };
}
