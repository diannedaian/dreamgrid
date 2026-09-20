// Catalog store: products plus their model assets, grouped by category.
import type { ModelAsset, Product } from "@contracts";
import { FIXTURE_ASSETS, FIXTURE_PRODUCTS } from "./fixtures";
import { readGeneratedEntries } from "./generatedCatalog";
import { loadSavedProducts } from "../commerce/savedProducts";

export type CatalogEntry = { product: Product; asset?: ModelAsset };

export const CATEGORY_ORDER = ["bed", "desk", "chair", "shelf", "lamp", "decor", "misc"] as const;
export type CategoryKey = (typeof CATEGORY_ORDER)[number];
export const CATEGORY_LABELS: Record<CategoryKey, string> = { bed: "Beds", desk: "Desks", chair: "Chairs", shelf: "Shelves", lamp: "Lamps", decor: "Decor", misc: "Misc" };

/** Storage pieces the analyzer often files under desk/misc; they belong with shelves in the bar. */
const SHELF_TITLES = /\b(shoe (racks?|stacks?|organi[sz]ers?|shelves|shelf|cabinets?|storage)|book ?(shelf|shelves|cases?)|shelving|shelf units?|cube (storage|organi[sz]ers?)|storage (racks?|towers?))\b/i;

export class Catalog {
  private products = new Map<string, Product>();
  private assets = new Map<string, ModelAsset>();
  private listeners = new Set<() => void>();
  // Hide retired demo cards without breaking previously saved room plans.
  private hiddenProductIds = new Set<string>();
  // Cards the user dismissed with the × in the bottom bar (kept per browser; products stay loadable for saved plans).
  private userHidden = new Set<string>(readHidden());

  entries(): CatalogEntry[] {
    return [...this.products.values()].filter((p) => !this.hiddenProductIds.has(p.id) && !this.userHidden.has(p.id)).map((product) => ({ product, asset: product.modelAssetId ? this.assets.get(product.modelAssetId) : undefined }));
  }

  allProducts(): Product[] { return [...this.products.values()]; }

  get(productId: string): CatalogEntry | undefined {
    const product = this.products.get(productId);
    return product && { product, asset: product.modelAssetId ? this.assets.get(product.modelAssetId) : undefined };
  }

  /** Categories the contracts don't know about land in Misc; shelf-like storage always shows under Shelves. */
  static categoryOf(p: Product): CategoryKey {
    const c = p.category as string;
    if (c !== "bed" && c !== "chair" && SHELF_TITLES.test(p.title)) return "shelf";
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

  /** Hide a card from the bar (the product stays available so existing rooms still load). */
  hide(productId: string): void { this.userHidden.add(productId); writeHidden(this.userHidden); this.listeners.forEach((l) => l()); }
  unhideAll(): void { this.userHidden.clear(); writeHidden(this.userHidden); this.listeners.forEach((l) => l()); }
  hiddenCount(): number { return [...this.userHidden].filter((id) => this.products.has(id)).length; }

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
      c.add(loadSavedProducts().filter(p => !c.get(p.id)));
      // localStorage is optional (unit tests / blocked storage / private mode).
      try {
        for (const row of readGeneratedEntries()) {
          const saved = c.get(row.product.id)?.product;
          const product = saved?.modelAssetId === row.asset.id ? { ...saved, dimensionsM: row.asset.dimensionsM } : row.product;
          c.add([product], [row.asset]);
        }
      } catch { /* cached demo still works */ }
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

const HIDDEN_KEY = "dreamgrid.hiddenCards.v1";
function readHidden(): string[] { try { const v = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; } }
function writeHidden(ids: Set<string>): void { try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...ids])); } catch { /* ignore */ } }
