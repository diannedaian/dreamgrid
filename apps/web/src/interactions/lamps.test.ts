import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BoxGeometry, Group, HemisphereLight, Mesh, MeshStandardMaterial, Object3D, PointLight, SpotLight, Vector3 } from "three";
import type { ModelAsset, Product } from "@contracts";
import catalog from "../../public/demo-assets/catalog.json";
import { LampRegistry } from "./lamps";
import { loadModel } from "./models";

afterEach(() => vi.unstubAllGlobals());

function lights(root: Object3D): (PointLight | SpotLight)[] {
  const result: (PointLight | SpotLight)[] = [];
  root.traverse((node) => { if (node instanceof PointLight || node instanceof SpotLight) result.push(node); });
  return result;
}

describe("lamp registry", () => {
  it("loads the real Sol GLB with two aligned, movable night lights and independent instances", async () => {
    const bytes = readFileSync(new URL("../../public/demo-assets/torchiere-task-lamp.glb", import.meta.url));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) })));
    const product = catalog.products.find((p) => p.id === "torchiere-task-lamp") as Product;
    const asset = catalog.assets.find((a) => a.id === product.modelAssetId) as ModelAsset;
    const lamp = await loadModel(product, asset);
    const second = await loadModel(product, asset);
    expect(lamp.getObjectByName("top-bulb")).toBeDefined(); // not the loader's silent box fallback
    expect(lamp.getObjectByName("task-bulb")).toBeDefined();
    const registry = new LampRegistry();
    registry.registerLamp(lamp);
    // The bowl aimed at the ceiling becomes a wide room wash (point light) + hemisphere fill; the task light stays a spot.
    const emitters = lights(lamp);
    expect(emitters).toHaveLength(2);
    expect(emitters.every((light) => light.intensity === 0)).toBe(true);
    const wash = emitters.find((l) => l.name.includes("top")) as PointLight;
    const task = emitters.find((l) => l.name.includes("task")) as SpotLight;
    expect(wash).toBeInstanceOf(PointLight);
    expect(task).toBeInstanceOf(SpotLight);
    const fills: HemisphereLight[] = [];
    lamp.traverse((node) => { if (node instanceof HemisphereLight) fills.push(node); });
    expect(fills).toHaveLength(1);
    lamp.position.set(-1, 0, -0.5);
    lamp.rotation.y = Math.PI / 2;
    lamp.updateWorldMatrix(true, true);
    for (const [light, bulbName] of [[wash, "top-bulb"], [task, "task-bulb"]] as const) {
      const bulbPosition = lamp.getObjectByName(bulbName)!.getWorldPosition(new Vector3());
      expect(light.getWorldPosition(new Vector3()).distanceTo(bulbPosition)).toBeLessThan(0.001);
    }
    const direction = task.target.getWorldPosition(new Vector3()).sub(task.getWorldPosition(new Vector3())).normalize();
    expect(direction.y).toBeLessThan(0); expect(direction.z).toBeLessThan(-0.8);
    registry.setMode("night");
    expect(wash.intensity).toBeCloseTo(1.8); // artistic room-preview scale, not measured brightness
    expect(task.intensity).toBeCloseTo(2);
    expect(fills[0].intensity).toBeCloseTo(0.35);
    const bulb = lamp.getObjectByName("top-bulb") as Mesh;
    const secondBulb = second.getObjectByName("top-bulb") as Mesh;
    expect((bulb.material as MeshStandardMaterial).emissiveIntensity).toBe(2.2); // the bowl glows harder than a task bulb
    expect(bulb.material).not.toBe(secondBulb.material);
    expect(lights(second)).toHaveLength(0);
    const pole = lamp.getObjectByName("main-pole") as Mesh;
    expect((pole.material as MeshStandardMaterial).emissive.getHex()).toBe(0);
    registry.setMode("day");
    expect(emitters.every((light) => light.intensity === 0)).toBe(true);
    expect((bulb.material as MeshStandardMaterial).emissiveIntensity).toBe(0);
    const target = task.target;
    registry.unregister(lamp);
    expect(lights(lamp)).toHaveLength(0);
    expect(target.parent).toBeNull();
    let fillsLeft = 0; lamp.traverse((node) => { if (node instanceof HemisphereLight) fillsLeft++; });
    expect(fillsLeft).toBe(0);
  });

  it("keeps the fixture fallback and safely ignores invalid lighting metadata", () => {
    const lamp = new Group();
    lamp.userData.dreamgridLighting = { coordinateSpace: "model-local", activation: "night", sources: [{ type: "spot" }] };
    const bulb = new Mesh(new BoxGeometry(0.1, 1, 0.1), new MeshStandardMaterial());
    bulb.name = "bulb";
    lamp.add(bulb);
    const registry = new LampRegistry();
    registry.setMode("night");
    registry.registerLamp(lamp);
    registry.registerLamp(lamp);
    expect(lights(lamp)).toHaveLength(1);
    expect(lights(lamp)[0]).toBeInstanceOf(PointLight);
    expect(lights(lamp)[0].intensity).toBe(1.4);
    registry.unregister(lamp);
    expect(lights(lamp)).toHaveLength(0);
  });
});
