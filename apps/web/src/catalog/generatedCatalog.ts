import { validateModelAsset, validateProduct, type ModelAsset, type Product } from "@contracts";

export type GeneratedEntry = { product: Product; asset: ModelAsset };
const KEY = "dreamgrid.generated-catalog.v1";

/** Laptop MVP persistence. Metadata only: uploaded images and credentials are not saved. */
export function readGeneratedEntries(storage: Pick<Storage, "getItem"> = localStorage): GeneratedEntry[] {
  try {
    const rows: unknown = JSON.parse(storage.getItem(KEY) || "[]");
    if (!Array.isArray(rows)) return [];
    return rows.slice(-100).filter((row): row is GeneratedEntry => {
      if (!row || !validateProduct(row.product) || !validateModelAsset(row.asset)) return false;
      return row.product.id === row.asset.productId && row.product.modelAssetId === row.asset.id
        && row.asset.status === "ready"
        && /^\/api\/v1\/models\/assets\/[a-f0-9]{64}\.glb$/.test(row.asset.glbUrl)
        && (!row.product.sourceUrl || /^https?:\/\//.test(row.product.sourceUrl));
    });
  } catch { return []; }
}

export function saveGeneratedEntry(entry: GeneratedEntry, storage: Pick<Storage, "getItem" | "setItem"> = localStorage): void {
  const rows = readGeneratedEntries(storage).filter((row) => row.product.id !== entry.product.id);
  storage.setItem(KEY, JSON.stringify([...rows, entry].slice(-100)));
}
