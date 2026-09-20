// The last step of every sourcing path (search hit, pasted link, typed by hand): a contract-valid
// Product joins the catalog right away (it renders as a sized box), is remembered in localStorage,
// and — when it came from a real product page — Cindy's importer is asked for a 3D model in the
// background. The model arrives as a ModelAsset that replaces the box on the next render.
import type { ModelAsset, Product } from "@dreamgrid/contracts";

import type { Catalog } from "../catalog/catalog";
import { saveProduct } from "./savedProducts";

export const MANUAL_SOURCE_URL = "https://example.com/manual-entry";

export type ModelOutcome = { kind: "model" | "box"; note: string };

export type CatalogAdder = {
  /** Add now; `model` settles when the 3D model attempt is done (never rejects). */
  add: (product: Product) => { product: Product; model: Promise<ModelOutcome> };
};

export type CatalogAdderOptions = {
  catalog: Catalog;
  /** Cindy's `/api/import-product`: page → FurnitureSpec. Absent in view-only mode. */
  importModel?: (url: string) => Promise<{ product: Product; asset: ModelAsset }>;
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
 * imported earlier (same id) keeps its model while price and size come from the new product.
 */
export function addKeepingModels(catalog: Catalog, products: Product[]): Product[] {
  const merged = products.map((p) => {
    const existing = catalog.get(p.id)?.product.modelAssetId;
    return existing && !p.modelAssetId ? { ...p, modelAssetId: existing } : p;
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
      const model = added.modelAssetId ? Promise.resolve<ModelOutcome>({ kind: "model", note: "3D model ready." }) : buildModel(added);
      return { product: added, model };
    },
  };

  async function buildModel(product: Product): Promise<ModelOutcome> {
    const url = product.sourceUrl;
    if (!o.importModel || !/^https?:\/\//.test(url) || url === MANUAL_SOURCE_URL) {
      return { kind: "box", note: "Shown as a box sized from its dimensions." };
    }
    try {
      const r = await o.importModel(url);
      // Keep this pipeline's price and size (the listing's own numbers); take only the model.
      const withModel: Product = { ...product, modelAssetId: r.asset.id, imageUrl: product.imageUrl || r.product.imageUrl };
      o.catalog.add([withModel], [{ ...r.asset, productId: product.id }]);
      save(withModel);
      return { kind: "model", note: "3D model ready." };
    } catch (e) {
      return { kind: "box", note: `Shown as a sized box (${(e as Error).message}).` };
    }
  }
}
