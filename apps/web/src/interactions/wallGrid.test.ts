import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { cellAt, doorArc, footprintBlocksDoor, fromWallUV, toWallUV, windowFromCells } from "./wallGrid";
import { feetInchesToM, mToInches } from "./units";

const room = { widthM: feetInchesToM(12, 0), depthM: feetInchesToM(10, 0), heightM: feetInchesToM(8, 0), gridSizeM: 0.0254, lightingMode: "day" as const };

describe("wall coordinates", () => {
  it("round-trips wall-local and world points on both walls", () => {
    for (const s of ["back-wall", "left-wall"] as const) {
      const p = fromWallUV(s, 1.0, 0.5, room);
      expect(toWallUV(s, p, room)).toEqual([1.0, 0.5]);
    }
  });

  it("finds the inch cell containing a point", () => {
    expect(cellAt(0.0254 * 5.5, 0.0254 * 40.2, 0.0254)).toEqual({ i: 5, j: 40 });
  });
});

describe("windowFromCells", () => {
  it("builds a window from top-left and bottom-right inch cells", () => {
    const w = windowFromCells("left-wall", [{ i: 20, j: 70 }, { i: 50, j: 40 }]);
    expect(mToInches(w.uM)).toBeCloseTo(20, 6);
    expect(mToInches(w.vM)).toBeCloseTo(40, 6);
    expect(mToInches(w.widthM)).toBeCloseTo(31, 6);
    expect(mToInches(w.heightM)).toBeCloseTo(31, 6);
  });

  it("builds the inch-aligned bounding rectangle of four cells", () => {
    const w = windowFromCells("back-wall", [
      { i: 30, j: 36 }, { i: 60, j: 36 }, { i: 30, j: 72 }, { i: 60, j: 72 },
    ]);
    expect(mToInches(w.uM)).toBeCloseTo(30, 6);
    expect(mToInches(w.vM)).toBeCloseTo(36, 6);
    expect(mToInches(w.widthM)).toBeCloseTo(31, 6);
    expect(mToInches(w.heightM)).toBeCloseTo(37, 6);
  });
});

describe("doors", () => {
  const door = windowFromCells("back-wall", [{ i: 24, j: 80 }, { i: 59, j: 5 }], "door"); // 36" wide, hinge 24" from the corner
  const arc = doorArc(door, room);

  it("reaches the floor and swings into the room from its left edge", () => {
    expect(door.vM).toBe(0);
    expect(mToInches(door.widthM)).toBeCloseTo(36, 6);
    expect(mToInches(arc.r)).toBeCloseTo(36, 6);
    expect(arc.cx).toBeCloseTo(-room.widthM / 2 + 24 * 0.0254, 6);
    expect(arc.cz).toBeCloseTo(-room.depthM / 2, 6);
  });

  it("flags furniture inside the swing and ignores furniture beside or beyond it", () => {
    const inside = [arc.cx + 0.3, arc.cz + 0.3];
    expect(footprintBlocksDoor(inside[0], inside[1], 0.4, 0.4, arc)).toBe(true);
    // Just past the arc radius, straight out from the hinge.
    expect(footprintBlocksDoor(arc.cx + 0.2, arc.cz + arc.r + 0.25, 0.3, 0.3, arc)).toBe(false);
    // On the hinge side of the door (behind the swing).
    expect(footprintBlocksDoor(arc.cx - 0.4, arc.cz + 0.3, 0.3, 0.3, arc)).toBe(false);
    // Big rug that overlaps the corner of the swing.
    expect(footprintBlocksDoor(0, 0, room.widthM, room.depthM, arc)).toBe(true);
  });
});
