import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { Box3, Mesh, MeshStandardMaterial, Vector3 } from "three";
import type { ModelAsset, Product } from "@contracts";
import catalog from "../../public/demo-assets/catalog.json";
import { loadModel } from "./models";
import { priceKnown, summarizeBudget } from "../commerce/budget";
import { listHtml } from "../catalog/shoppingList";

afterEach(() => vi.unstubAllGlobals());

it("loads the textured queen bed without changing its size, pivot, or front direction", async () => {
  const bytes = readFileSync(new URL("../../public/demo-assets/chenille-queen-bed.glb", import.meta.url));
  const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  expect(json.images.every((image: { uri?: string }) => !image.uri)).toBe(true);
  expect(json.cameras ?? []).toHaveLength(0);
  expect(json.extensions?.KHR_lights_punctual).toBeUndefined();
  const nativeFetch = globalThis.fetch;
  vi.stubGlobal("self", globalThis);
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 1024, height: 1024, close() {} })));
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url.startsWith("blob:") ? nativeFetch(url) : { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }));
  const product = catalog.products.find(p => p.id === "chenille-queen-bed") as Product;
  const asset = catalog.assets.find(a => a.id === product.modelAssetId) as ModelAsset;
  const model = await loadModel(product, asset);
  model.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(model, true);
  bounds.getSize(new Vector3()).toArray().forEach((n, i) => expect(n).toBeCloseTo(product.dimensionsM[i], 3));
  expect(bounds.min.y).toBeCloseTo(0, 5);
  expect(bounds.getCenter(new Vector3()).x).toBeCloseTo(0, 5);
  expect(bounds.getCenter(new Vector3()).z).toBeCloseTo(0, 5);
  let meshes = 0, textures = 0, triangles = 0;
  let head: Mesh | undefined, foot: Mesh | undefined;
  model.traverse(node => {
    if (!(node instanceof Mesh)) return;
    meshes++;
    triangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    if (materials.some(m => m instanceof MeshStandardMaterial && m.map)) textures++;
    if (node.name.includes("Headboard") && node.name.includes("61in")) head = node;
    if (node.name.includes("Footboard") && node.name.includes("57")) foot = node;
  });
  expect(meshes).toBeGreaterThan(40);
  expect(textures).toBeGreaterThan(10);
  expect(triangles).toBeLessThan(40000);
  expect(head?.getWorldPosition(new Vector3()).z).toBeLessThan(0);
  expect(foot?.getWorldPosition(new Vector3()).z).toBeGreaterThan(0);
});

it("leaves the bed price blank in shopping rows while keeping it unpriced for budgets", () => {
  const product = catalog.products.find(p => p.id === "chenille-queen-bed") as Product;
  expect(priceKnown(product)).toBe(false);
  const html = listHtml([{ product, qty: 1 }]);
  expect(html).toContain('<span class="li-price"></span>');
  expect(html).not.toMatch(/Price not provided|Price unknown|No price available/);
  const summary = summarizeBudget({ room: { widthM: 4, depthM: 4, heightM: 3, gridSizeM: .0254, lightingMode: "day" }, budgetUsd: 500, items: [{ id: "bed", productId: product.id, modelAssetId: product.modelAssetId!, positionM: [0, 0, 0], rotationYDeg: 0 }] }, [product]);
  expect(summary.subtotalUsd).toBe(0);
  expect(summary.unpricedItemIds).toEqual(["bed"]);
});
