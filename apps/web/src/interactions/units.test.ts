import { describe, expect, it } from "vitest";
import { feetInchesToM, mToInches, snapToInch, snapToRoomGrid, snapToSurface } from "./units";

describe("units", () => {
  it("converts feet and inches to meters", () => {
    expect(feetInchesToM(1, 0)).toBeCloseTo(0.3048, 6);
    expect(feetInchesToM(0, 1)).toBeCloseTo(0.0254, 6);
    expect(mToInches(feetInchesToM(12, 6))).toBeCloseTo(150, 6);
  });

  it("snaps to the nearest inch", () => {
    expect(mToInches(snapToInch(0.03))).toBe(1);
    expect(mToInches(snapToInch(0.04))).toBe(2);
  });

  it("snaps positions to inch lines measured from the walls and clamps to the room", () => {
    const [w, d] = [feetInchesToM(10, 0), feetInchesToM(8, 0)];
    const [x, z] = snapToRoomGrid(0.01, 0.01, w, d);
    expect(mToInches(x + w / 2)).toBeCloseTo(60, 6);
    expect(mToInches(z + d / 2)).toBeCloseTo(48, 6);
    const [cx, cz] = snapToRoomGrid(99, -99, w, d);
    expect(cx).toBeCloseTo(w / 2, 6);
    expect(cz).toBeCloseTo(-d / 2, 6);
  });
});

describe("snapToSurface", () => {
  const room = { widthM: feetInchesToM(10, 0), depthM: feetInchesToM(8, 0), heightM: feetInchesToM(8, 0) };

  it("pins floor items to y = 0", () => {
    const [, y] = snapToSurface("floor", [0, 0.5, 0], room);
    expect(y).toBe(0);
  });

  it("pins wall items flush to the wall and snaps height to the inch", () => {
    const [x, y, z] = snapToSurface("back-wall", [0.1, 1.001, 0.3], room);
    expect(z).toBeCloseTo(-room.depthM / 2, 6);
    expect(mToInches(y)).toBeCloseTo(39, 6);
    expect(mToInches(x + room.widthM / 2)).toBeCloseTo(64, 6);
    const [lx] = snapToSurface("left-wall", [0, 0, 0], room);
    expect(lx).toBeCloseTo(-room.widthM / 2, 6);
  });

  it("never lets wall items go below the floor or above the ceiling", () => {
    expect(snapToSurface("back-wall", [0, -5, 0], room)[1]).toBe(0);
    expect(snapToSurface("left-wall", [0, 50, 0], room)[1]).toBeCloseTo(room.heightM, 6);
  });
});
