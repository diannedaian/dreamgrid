import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Box3, Mesh, MeshStandardMaterial, Vector3 } from "three";
import type { ModelAsset, Product } from "@contracts";
import catalog from "../../public/demo-assets/catalog.json";
import { loadModel } from "./models";
import { isWallMount } from "./placement";

afterEach(() => vi.unstubAllGlobals());

const curated = [
  { id: "green-velvet-mirror", file: "green-velvet-mirror.glb", maxTriangles: 30000, wall: true },
  { id: "prisco-olive-rug", file: "prisco-olive-rug.glb", maxTriangles: 30000, wall: false },
  { id: "green-boucle-lounge-chair", file: "green-boucle-lounge-chair.glb", maxTriangles: 30000, wall: false },
];

describe("user-supplied curated models", () => {
  it.each(curated)("$id loads at its catalog size with a bottom-centre pivot and embedded textures", async ({ id, file, maxTriangles, wall }) => {
    const bytes = readFileSync(new URL(`../../public/demo-assets/${file}`, import.meta.url));
    const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    expect(json.images?.length ?? 0).toBeGreaterThan(0);
    expect(json.images.every((image: { uri?: string }) => !image.uri)).toBe(true);
    expect(json.cameras ?? []).toHaveLength(0);
    expect(json.extensions?.KHR_lights_punctual).toBeUndefined();
    const nativeFetch = globalThis.fetch;
    vi.stubGlobal("self", globalThis);
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 512, height: 512, close() {} })));
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.startsWith("blob:") ? nativeFetch(url) : { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }));
    const product = catalog.products.find(p => p.id === id) as Product;
    const asset = catalog.assets.find(a => a.id === product.modelAssetId) as ModelAsset;
    expect(isWallMount(product)).toBe(wall);
    const model = await loadModel(product, asset);
    model.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(model, true);
    bounds.getSize(new Vector3()).toArray().forEach((n, i) => expect(n).toBeCloseTo(product.dimensionsM[i], 3));
    expect(bounds.min.y).toBeCloseTo(0, 4);
    expect(bounds.getCenter(new Vector3()).x).toBeCloseTo(0, 4);
    expect(bounds.getCenter(new Vector3()).z).toBeCloseTo(0, 4);
    let textured = 0, triangles = 0;
    model.traverse(node => {
      if (!(node instanceof Mesh)) return;
      triangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      if (materials.some(m => m instanceof MeshStandardMaterial && (m.map || m.normalMap))) textured++;
    });
    expect(textured).toBeGreaterThan(0);
    expect(triangles).toBeLessThan(maxTriangles);
  });
});
