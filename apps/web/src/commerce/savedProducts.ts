// Products the user added through the shop drawer (search, link, or by hand) live only in the
// browser, so keep them in localStorage and put them back into the catalog on the next load.
// Dianne's catalog.json and Cindy's importer own the products with 3D models; this is just the
// price/size data Linda's pipeline produced for them.
import { validateProduct, type Product } from "@dreamgrid/contracts";

const KEY = "dreamgrid.products";

export function loadSavedProducts(storage: Storage | undefined = safeStorage()): Product[] {
  try {
    const raw = storage?.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.slice(-100).filter((p): p is Product => validateProduct(p) && (!p.sourceUrl || /^https?:\/\//.test(p.sourceUrl)) && (!p.imageUrl || /^https?:\/\//.test(p.imageUrl) || p.imageUrl.startsWith("/demo-assets/"))) : [];
  } catch {
    return [];
  }
}

/** Add or replace one product (same id wins) and persist. */
export function saveProduct(product: Product, storage: Storage | undefined = safeStorage()): void {
  if (!storage) return;
  const rest = loadSavedProducts(storage).filter((p) => p.id !== product.id);
  try {
    storage.setItem(KEY, JSON.stringify([...rest, product].slice(-100)));
  } catch { /* quota or private mode: the product still lives in the catalog until reload */ }
}

function safeStorage(): Storage | undefined {
  try { return typeof localStorage === "undefined" ? undefined : localStorage; } catch { return undefined; }
}
