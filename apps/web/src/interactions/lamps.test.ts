import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Object3D, PointLight, SpotLight, Vector3 } from "three";
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
    const emitters = lights(lamp) as SpotLight[];
    expect(emitters).toHaveLength(2);
    expect(emitters.every((light) => light instanceof SpotLight && light.intensity === 0)).toBe(true);
    lamp.position.set(-1, 0, -0.5);
    lamp.rotation.y = Math.PI / 2;
    lamp.updateWorldMatrix(true, true);
    for (const light of emitters) {
      const bulbName = light.name.includes("top") ? "top-bulb" : "task-bulb";
      const bulbPosition = lamp.getObjectByName(bulbName)!.getWorldPosition(new Vector3());
      expect(light.getWorldPosition(new Vector3()).distanceTo(bulbPosition)).toBeLessThan(0.001);
      const direction = light.target.getWorldPosition(new Vector3()).sub(light.getWorldPosition(new Vector3())).normalize();
      if (bulbName === "top-bulb") expect(direction.y).toBeCloseTo(1);
      else { expect(direction.y).toBeLessThan(0); expect(direction.z).toBeLessThan(-0.8); }
    }
    registry.setMode("night");
    expect(emitters.map((light) => light.intensity)).toEqual([2, 2]); // artistic room-preview scale, not measured brightness
    const bulb = lamp.getObjectByName("top-bulb") as Mesh;
    const secondBulb = second.getObjectByName("top-bulb") as Mesh;
    expect((bulb.material as MeshStandardMaterial).emissiveIntensity).toBe(0.8);
    expect(bulb.material).not.toBe(secondBulb.material);
    expect(lights(second)).toHaveLength(0);
    const pole = lamp.getObjectByName("main-pole") as Mesh;
    expect((pole.material as MeshStandardMaterial).emissive.getHex()).toBe(0);
    registry.setMode("day");
    expect(emitters.every((light) => light.intensity === 0)).toBe(true);
    expect((bulb.material as MeshStandardMaterial).emissiveIntensity).toBe(0);
    const targets = emitters.map((light) => light.target);
    registry.unregister(lamp);
    expect(lights(lamp)).toHaveLength(0);
    expect(targets.every((target) => target.parent === null)).toBe(true);
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
