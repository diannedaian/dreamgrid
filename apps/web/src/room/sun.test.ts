import { describe, expect, it } from "vitest";
import { TIME_T, headingLabel, lookAt, nearestTime, snapT, sunAzElAt, toSunVector } from "./sun";

describe("sun direction", () => {
  it("puts the sunrise sun to the east of a north-facing far wall (room's +X side)", () => {
    const v = toSunVector({ t: TIME_T.sunrise, headingDeg: 0, southern: false });
    expect(v.x).toBeGreaterThan(0.9);
    expect(v.y).toBeGreaterThan(0);
    expect(Math.abs(v.z)).toBeLessThan(0.05);
  });

  it("shines sunset light straight into a west-facing far wall", () => {
    const v = toSunVector({ t: TIME_T.sunset, headingDeg: 270, southern: false });
    expect(v.z).toBeLessThan(-0.9);
  });

  it("flips the midday sun for the southern hemisphere", () => {
    const north = toSunVector({ t: TIME_T.noon, headingDeg: 0, southern: false });
    const south = toSunVector({ t: TIME_T.noon, headingDeg: 0, southern: true });
    expect(north.z).toBeGreaterThan(0);
    expect(south.z).toBeLessThan(0);
    expect(headingLabel(315)).toBe("NW");
  });
});

describe("time slider", () => {
  it("interpolates between checkpoints", () => {
    const mid = sunAzElAt(1 / 6, false); // halfway from sunrise to noon
    expect(mid.azDeg).toBeCloseTo(135, 6);
    expect(mid.elDeg).toBeCloseTo(39, 6);
    expect(lookAt(1 / 6).sunIntensity).toBeCloseTo((3.2 + 2.3) / 2, 6);
  });

  it("takes the short way round the compass between sunset and midnight", () => {
    const { azDeg } = sunAzElAt(5 / 6, false); // sunset (270) → midnight (0)
    expect(azDeg).toBeCloseTo(315, 6);
  });

  it("snaps onto nearby checkpoints and names the nearest one", () => {
    expect(snapT(0.35)).toBeCloseTo(1 / 3, 9);
    expect(snapT(0.5)).toBe(0.5);
    expect(nearestTime(0.9)).toBe("midnight");
    expect(lookAt(0.5).lampsOn).toBe(false);
    expect(lookAt(0.7).lampsOn).toBe(true);
  });
});
