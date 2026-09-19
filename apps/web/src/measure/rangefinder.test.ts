import { describe, expect, it } from "vitest";
import { ceilingHeight, distanceToFloorPoint, pitchFromBeta, toInches } from "./rangefinder";

describe("rangefinder", () => {
  it("reads pitch from a portrait phone's beta", () => {
    expect(pitchFromBeta(90)).toBe(0); // held vertical, aiming level
    expect(pitchFromBeta(60)).toBe(-30); // tilted to look down 30°
  });

  it("solves distance from height and downward angle", () => {
    // 1.4 m high, looking 30° down → 1.4 / tan(30°) ≈ 2.425 m
    expect(distanceToFloorPoint(1.4, -30)!).toBeCloseTo(2.425, 3);
    expect(distanceToFloorPoint(1.4, -1)).toBeNull();
    expect(distanceToFloorPoint(1.4, 10)).toBeNull();
  });

  it("solves ceiling height from distance and upward angle", () => {
    // 1.4 m high, wall 3 m away, ceiling line 20° up → 1.4 + 3·tan(20°) ≈ 2.492 m
    expect(ceilingHeight(1.4, 3, 20)!).toBeCloseTo(2.492, 3);
    expect(ceilingHeight(1.4, 3, 1)).toBeNull();
  });

  it("rounds to inches with the body offset", () => {
    expect(toInches(3.048)).toBe(120);
    expect(toInches(3.048, 10)).toBe(130);
  });
});
