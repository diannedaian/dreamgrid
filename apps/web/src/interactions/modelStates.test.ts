import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Box3, Group, Mesh, MeshPhysicalMaterial, Vector3 } from "three";
import type { Product, ModelAsset } from "@contracts";
import catalog from "../../public/demo-assets/catalog.json";
import { loadModel } from "./models";
import { createModelState } from "./modelStates";

afterEach(() => vi.unstubAllGlobals());

describe("hinged mini fridge", () => {
  it("opens only the door, keeps the cabinet fixed, and closes exactly", async () => {
    const bytes = readFileSync(new URL("../../public/demo-assets/mini-fridge.glb", import.meta.url));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) })));
    const product = catalog.products.find((p) => p.id === "p-mini-fridge") as Product;
    const asset = catalog.assets.find((a) => a.id === product.modelAssetId) as ModelAsset;
    const fridge = await loadModel(product, asset);
    const other = await loadModel(product, asset);
    fridge.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      for (const mat of mats) if (mat instanceof MeshPhysicalMaterial) expect(mat.anisotropy).toBe(0);
    });
    const size = new Box3().setFromObject(fridge).getSize(new Vector3());
    size.toArray().forEach((value, i) => expect(value).toBeCloseTo(product.dimensionsM[i], 5));
    expect(new Box3().setFromObject(fridge).min.y).toBeCloseTo(0, 6);
    const hinge = fridge.getObjectByName("DOOR_PIVOT_•_rotate_Z_to_open")!;
    expect(hinge).toBeDefined(); // not a silent fallback box
    const state = createModelState(fridge, product.id)!;
    const otherState = createModelState(other, product.id)!;
    fridge.position.set(1, 0, -0.5);
    fridge.rotation.y = Math.PI / 2;
    fridge.updateWorldMatrix(true, true);
    const cabinet = fridge.getObjectByName("Cabinet_top")!;
    const cabinetBefore = cabinet.getWorldPosition(new Vector3());
    const hingeBefore = hinge.getWorldPosition(new Vector3());
    const closed = hinge.quaternion.clone();
    state.setOpen(true);
    expect(state.isOpen).toBe(true);
    expect(otherState.isOpen).toBe(false);
    expect(closed.angleTo(hinge.quaternion)).toBeCloseTo(110 * Math.PI / 180, 5);
    expect(cabinet.getWorldPosition(new Vector3()).distanceTo(cabinetBefore)).toBeLessThan(1e-8);
    expect(hinge.getWorldPosition(new Vector3()).distanceTo(hingeBefore)).toBeLessThan(1e-8);
    const openPose = hinge.quaternion.clone();
    state.setOpen(true);
    expect(hinge.quaternion.equals(openPose)).toBe(true); // no accumulated rotations
    state.setOpen(false);
    expect(state.isOpen).toBe(false);
    expect(hinge.quaternion.equals(closed)).toBe(true);
  });

  it("does not offer a door control for unsupported or failed models", () => {
    expect(createModelState(new Group(), "p-mini-fridge")).toBeUndefined();
    expect(createModelState(new Group(), "college-bed")).toBeUndefined();
  });
});
