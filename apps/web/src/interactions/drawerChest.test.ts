import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { Box3, Mesh, MeshStandardMaterial, Object3D, Vector3 } from "three";
import type { ModelAsset, Product } from "@contracts";
import catalog from "../../public/demo-assets/catalog.json";
import { loadModel } from "./models";

afterEach(() => vi.unstubAllGlobals());

it("loads the real textured chest at its published size with all four drawer groups", async () => {
  const bytes = readFileSync(new URL("../../public/demo-assets/campus-drawer-chest.glb", import.meta.url));
  const nativeFetch = globalThis.fetch;
  vi.stubGlobal("self", globalThis);
  // Node has no image decoder. Exercise embedded-image wiring here; the browser
  // smoke test verifies the actual oak pixels and material rendering.
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 1024, height: 1024, close() {} })));
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url.startsWith("blob:")
    ? nativeFetch(url)
    : { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }));
  const product = catalog.products.find((p) => p.id === "campus-drawer-chest") as Product;
  const asset = catalog.assets.find((a) => a.id === product.modelAssetId) as ModelAsset;
  const chest = await loadModel(product, asset);
  const box = new Box3().setFromObject(chest);
  box.getSize(new Vector3()).toArray().forEach((value, i) => expect(value).toBeCloseTo(product.dimensionsM[i], 4));
  expect(box.min.y).toBeCloseTo(0, 6);
  expect(box.getCenter(new Vector3()).x).toBeCloseTo(0, 6);
  expect(box.getCenter(new Vector3()).z).toBeCloseTo(0, 6);
  const drawers: Object3D[] = [];
  let texturedMeshes = 0;
  chest.traverse((node) => {
    if (/^DRAWER_[1-4]_/.test(node.name)) drawers.push(node);
    if (!(node instanceof Mesh)) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    if (materials.some((m) => m instanceof MeshStandardMaterial && m.map && m.normalMap)) texturedMeshes++;
  });
  expect(drawers).toHaveLength(4); // A fallback cube must not pass this test.
  expect(drawers.every((drawer) => drawer.children.length > 0)).toBe(true);
  expect(texturedMeshes).toBeGreaterThan(4);
  expect(globalThis.createImageBitmap).toHaveBeenCalledTimes(2);
});
