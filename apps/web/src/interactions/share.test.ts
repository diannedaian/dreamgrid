import { describe, expect, it } from "vitest";
import { decodePlan, encodePlan, planFromState, planUrl, roomFromPlan, sunFromPlan, windowsFromPlan, type Plan } from "./share";
import { feetInchesToM, mToInches } from "./units";

const room = { widthM: feetInchesToM(12, 0), depthM: feetInchesToM(10, 6), heightM: feetInchesToM(8, 0), gridSizeM: 0.0254, lightingMode: "day" as const };
const windows = [{ surface: "back-wall" as const, uM: 30 * 0.0254, vM: 36 * 0.0254, widthM: 40 * 0.0254, heightM: 48 * 0.0254 }];

describe("share plan", () => {
  it("round-trips a plan through the URL encoding", () => {
    const plan = planFromState(room, windows);
    const url = planUrl(plan, true, "http://10.0.0.5:5173/?w=1");
    const q = new URL(url).searchParams;
    expect(q.get("view")).toBe("1");
    expect(q.get("w")).toBeNull();
    const back = decodePlan(q.get("plan")!);
    expect(back).toEqual(plan);
    expect(mToInches(roomFromPlan(back!).depthM)).toBeCloseTo(126, 6);
    expect(windowsFromPlan(back!)[0]).toEqual(windows[0]);
  });

  it("carries the sun settings and maps midnight to the night contract", () => {
    const sun = { t: 1, headingDeg: 270, southern: true };
    const back = decodePlan(encodePlan(planFromState(room, [], [], { sun })))!;
    expect(sunFromPlan(back)).toEqual(sun);
    expect(roomFromPlan(back).lightingMode).toBe("night");
    expect(sunFromPlan(decodePlan(encodePlan(planFromState(room, [], [], { sun: { t: 0.5, headingDeg: 0, southern: false } })))!).t).toBeCloseTo(0.5, 6);
    const dflt = planFromState(room, []);
    expect(dflt.t).toBeUndefined(); expect(dflt.hd).toBeUndefined(); expect(dflt.sh).toBeUndefined();
  });

  it("carries paint, floor, and placed items", () => {
    const item = { id: "i1", productId: "p-desk", modelAssetId: "m-desk", positionM: [0.12345678, 0, -1] as [number, number, number], rotationYDeg: 90 as const };
    const plan = planFromState(room, [], [item], { paint: "#cfd8c4", floor: "tile-white" });
    const back = decodePlan(encodePlan(plan))!;
    expect(back.paint).toBe("cfd8c4");
    expect(back.floor).toBe("tile-white");
    expect(back.items[0].positionM[0]).toBeCloseTo(0.1235, 4);
    expect(back.items[0].rotationYDeg).toBe(90);
  });

  it("uses only URL-safe characters", () => {
    const plan: Plan = { v: 1, w: 200, d: 199, h: 97, win: [{ s: "l", u: 7, v: 3, w: 63, h: 62 }], items: [] };
    expect(encodePlan(plan)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("rejects garbage", () => {
    expect(decodePlan("not-a-plan")).toBeNull();
    expect(decodePlan(encodePlan({ v: 1, w: -1, d: 1, h: 1, win: [], items: [] }))).toBeNull();
  });
});
