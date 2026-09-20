// The last step of every sourcing path (search hit, pasted link, typed by hand): a contract-valid
// Product joins the catalog right away, is remembered in localStorage, and opens the image-first
// importer for explicit image upload and size confirmation. No paid analysis starts here.
// The generated GLB is attached by main only after it loads successfully.
import type { Product } from "@dreamgrid/contracts";

import type { Catalog } from "../catalog/catalog";
import { saveProduct } from "./savedProducts";

export const MANUAL_SOURCE_URL = "https://example.com/manual-entry";

export type ModelOutcome = { kind: "model" | "pending"; note: string };

export type CatalogAdder = {
  /** Add now; `model` reports ready or awaiting image/size confirmation (never rejects). */
  add: (product: Product) => { product: Product; model: Promise<ModelOutcome> };
};

export type CatalogAdderOptions = {
  catalog: Catalog;
  /** Open Cindy's image-first importer; absent when only restoring saved products. */
  openGeneration?: (product: Product) => void;
  save?: (product: Product) => void;
};

/**
 * Same id Cindy's importer derives for a page (`imp-` + 16 hex of sha1(url)), so the product
 * this pipeline builds and the entry the importer writes to catalog.json are one catalog row.
 */
export async function productIdFor(sourceUrl: string): Promise<string> {
  const url = sourceUrl.trim();
  if (!/^https?:\/\//.test(url) || url === MANUAL_SOURCE_URL || !globalThis.crypto?.subtle) {
    return `product-import-${crypto.randomUUID()}`;
  }
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(url));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `imp-${hex.slice(0, 16)}`;
}

/**
 * Add products over what the catalog already holds without dropping a 3D model: the same page
 * imported earlier (same id) keeps its model and reviewed size while price can be updated.
 */
export function addKeepingModels(catalog: Catalog, products: Product[]): Product[] {
  const merged = products.map((p) => {
    const existing = catalog.get(p.id);
    return existing?.asset?.status === "ready" ? { ...p, modelAssetId: existing.asset.id, dimensionsM: existing.asset.dimensionsM, styleTags: p.styleTags.filter(t => t !== "model-pending") } : p;
  });
  catalog.add(merged);
  return merged;
}

export function createCatalogAdder(o: CatalogAdderOptions): CatalogAdder {
  const save = o.save ?? saveProduct;
  return {
    add(product) {
      const [added] = addKeepingModels(o.catalog, [product]);
      save(added);
      const model = o.catalog.get(added.id)?.asset?.status === "ready" ? Promise.resolve<ModelOutcome>({ kind: "model", note: "3D model ready." }) : buildModel(added);
      return { product: added, model };
    },
  };

  async function buildModel(product: Product): Promise<ModelOutcome> {
    try {
      // Carry source details into the image-first flow; the final reviewed model owns its size.
      o.openGeneration?.(product);
      return { kind: "pending", note: "Upload an image and confirm dimensions to generate a model." };
    } catch (e) {
      return { kind: "pending", note: `Model not generated: ${(e as Error).message}` };
    }
  }
}
