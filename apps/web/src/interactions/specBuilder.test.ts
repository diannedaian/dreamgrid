import { describe, expect, it } from "vitest";
import { tidySpec, type FurnitureSpec } from "./specBuilder";

const spec: FurnitureSpec = {
  name: "table", category: "desk", dimensionsM: [0.55, 0.45, 0.55],
  materials: [{ id: "w", name: "white", baseColorHex: "#ffffff", roughness: 0.6, metallic: 0 }],
  parts: [
    { id: "top", primitive: "box", role: "top", dimensionsM: [0.55, 0.02, 0.55], positionM: [0, 0.225, 0], rotationDeg: [0, 0, 0], materialId: "w" },
    { id: "leg", primitive: "box", role: "leg", dimensionsM: [0.05, 0.45, 0.05], positionM: [-0.25, 0.225, -0.25], rotationDeg: [0, 0, 0], materialId: "w", repeat: { count: 2, offsetM: [0.5, 0, 0] } },
  ],
};

describe("tidySpec", () => {
  it("lifts a mid-height top to the item's height and trims legs to meet it", () => {
    const t = tidySpec(spec);
    const top = t.parts[0], leg = t.parts[1];
    expect(top.positionM[1] + top.dimensionsM[1] / 2).toBeCloseTo(0.45, 6);
    expect(leg.positionM[1] + leg.dimensionsM[1] / 2).toBeCloseTo(0.43, 6);
    expect(leg.positionM[1] - leg.dimensionsM[1] / 2).toBeCloseTo(0, 6);
    expect(spec.parts[0].positionM[1]).toBe(0.225); // input untouched
  });
});
