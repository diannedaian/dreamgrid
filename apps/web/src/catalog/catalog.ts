// Catalog store: products plus their model assets, grouped by category.
import type { ModelAsset, Product } from "@contracts";
import { FIXTURE_ASSETS, FIXTURE_PRODUCTS } from "./fixtures";
import { readGeneratedEntries } from "./generatedCatalog";

export type CatalogEntry = { product: Product; asset?: ModelAsset };

export const CATEGORY_ORDER = ["bed", "desk", "chair", "shelf", "lamp", "decor", "misc"] as const;
export type CategoryKey = (typeof CATEGORY_ORDER)[number];
export const CATEGORY_LABELS: Record<CategoryKey, string> = { bed: "Beds", desk: "Desks", chair: "Chairs", shelf: "Shelves", lamp: "Lamps", decor: "Decor", misc: "Misc" };

export class Catalog {
  private products = new Map<string, Product>();
  private assets = new Map<string, ModelAsset>();
  private listeners = new Set<() => void>();
  // Hide retired demo cards without breaking previously saved room plans.
  private hiddenProductIds = new Set<string>();

  entries(): CatalogEntry[] {
    return [...this.products.values()].filter((p) => !this.hiddenProductIds.has(p.id)).map((product) => ({ product, asset: product.modelAssetId ? this.assets.get(product.modelAssetId) : undefined }));
  }

  get(productId: string): CatalogEntry | undefined {
    const product = this.products.get(productId);
    return product && { product, asset: product.modelAssetId ? this.assets.get(product.modelAssetId) : undefined };
  }

  /** Categories the contracts don't know about land in Misc. */
  static categoryOf(p: Product): CategoryKey {
    const c = p.category as string;
    return (CATEGORY_ORDER as readonly string[]).includes(c) ? (c as CategoryKey) : "misc";
  }

  grouped(): Array<{ key: CategoryKey; label: string; entries: CatalogEntry[] }> {
    const buckets = new Map<CategoryKey, CatalogEntry[]>();
    for (const e of this.entries()) {
      const k = Catalog.categoryOf(e.product);
      (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(e);
    }
    return CATEGORY_ORDER.filter((k) => buckets.has(k)).map((key) => ({ key, label: CATEGORY_LABELS[key], entries: buckets.get(key)! }));
  }

  /** Add or replace products and assets (what Dianne's pipeline and Linda's feed call). */
  add(products: Product[], assets: ModelAsset[] = []): void {
    for (const p of products) this.products.set(p.id, p);
    for (const a of assets) this.assets.set(a.id, a);
    this.listeners.forEach((l) => l());
  }

  onChange(l: () => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /**
   * Load /demo-assets/catalog.json ({ products, assets, keepFixtures?, hiddenProductIds? }) if present, else fixtures.
   * With keepFixtures the built-in stand-ins stay alongside the real models (same ids override).
   */
  static async load(): Promise<Catalog> {
    const c = new Catalog();
    const generated = () => {
      // localStorage is optional (unit tests / blocked storage / private mode).
      try { for (const row of readGeneratedEntries()) c.add([row.product], [row.asset]); } catch { /* cached demo still works */ }
      return c;
    };
    try {
      const r = await fetch("/demo-assets/catalog.json", { cache: "no-store" });
      if (r.ok) {
        const j = (await r.json()) as { products?: Product[]; assets?: ModelAsset[]; keepFixtures?: boolean; hiddenProductIds?: string[] };
        if (j.products?.length) {
          if (j.keepFixtures) c.add(FIXTURE_PRODUCTS, FIXTURE_ASSETS);
          c.add(j.products, j.assets ?? []);
          c.hiddenProductIds = new Set(j.hiddenProductIds ?? []);
          return generated();
        }
      }
    } catch { /* fall back to fixtures */ }
    c.add(FIXTURE_PRODUCTS, FIXTURE_ASSETS);
    return generated();
  }
}
