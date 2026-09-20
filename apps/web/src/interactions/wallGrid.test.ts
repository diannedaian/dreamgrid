import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { cellAt, cornerWindowFromCells, doorArc, footprintBlocksDoor, fromWallUV, openingShape, openingsOverlap, toWallUV, windowFromCells } from "./wallGrid";
import { feetInchesToM, mToInches } from "./units";

const room = { widthM: feetInchesToM(12, 0), depthM: feetInchesToM(10, 0), heightM: feetInchesToM(8, 0), gridSizeM: 0.0254, lightingMode: "day" as const };

describe("opening outlines", () => {
  it("arched windows are a full-width half-circle on a rectangle, even when wider than tall", () => {
    for (const [w, h] of [[1.2, 1.5], [2.4, 1.5], [1.0, 2.0]]) {
      const pts = openingShape(w, h, "arch").getPoints(32);
      const ry = Math.min(w / 2, h);
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
      expect(Math.min(...xs)).toBeCloseTo(0, 6); expect(Math.max(...xs)).toBeCloseTo(w, 6);
      expect(Math.min(...ys)).toBeCloseTo(0, 6); expect(Math.max(...ys)).toBeCloseTo(h, 6);
      // The arc spans the whole width and springs from vertical sides: no shoulder, no diagonal.
      const crown = pts.find((p) => Math.abs(p.x - w / 2) < 1e-6 && p.y > h - ry + 1e-6)!;
      expect(crown.y).toBeCloseTo(h, 6);
      for (const p of pts) if (p.y < h - ry - 1e-6) expect(p.x === 0 || Math.abs(p.x - w) < 1e-6 || p.y === 0).toBe(true);
      for (const p of pts) if (p.y > h - ry + 1e-6) expect(((p.x - w / 2) / (w / 2)) ** 2 + ((p.y - (h - ry)) / ry) ** 2).toBeCloseTo(1, 4);
    }
  });
});

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

describe("openingsOverlap", () => {
  const a = { surface: "back-wall" as const, uM: 1, vM: 1, widthM: 1, heightM: 1 };
  it("detects overlap on the same wall and ignores other walls and touching edges", () => {
    expect(openingsOverlap(a, { ...a, uM: 1.5 })).toBe(true);
    expect(openingsOverlap(a, { ...a, uM: 2 })).toBe(false); // shares an edge
    expect(openingsOverlap(a, { ...a, surface: "left-wall" })).toBe(false);
    expect(openingsOverlap(a, { ...a, vM: 0, heightM: 0.5, kind: "door" })).toBe(false);
  });
});

describe("corner windows", () => {
  it("builds two halves that both run to the corner over the same height band", () => {
    const pair = cornerWindowFromCells({ surface: "back-wall", cell: { i: 40, j: 70 } }, { surface: "left-wall", cell: { i: 30, j: 36 } })!;
    expect(pair.map((w) => w.surface)).toEqual(["back-wall", "left-wall"]);
    for (const w of pair) { expect(w.uM).toBe(0); expect(w.corner).toBe(true); expect(mToInches(w.vM)).toBeCloseTo(36, 6); expect(mToInches(w.heightM)).toBeCloseTo(35, 6); }
    expect(mToInches(pair[0].widthM)).toBeCloseTo(41, 6);
    expect(mToInches(pair[1].widthM)).toBeCloseTo(31, 6);
    expect(cornerWindowFromCells({ surface: "back-wall", cell: { i: 1, j: 1 } }, { surface: "back-wall", cell: { i: 5, j: 5 } })).toBeNull();
  });
});
