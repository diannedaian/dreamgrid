// Product detail panel: bigger preview, size and price, and a slot for Linda's shopping info.
import type { CatalogEntry } from "./catalog";

export type DetailOptions = {
  thumbnail: (entry: CatalogEntry, size: number) => Promise<string | null>;
  onAdd: (entry: CatalogEntry) => void;
};

const IN = 0.0254;
const inches = (m: number) => Math.round(m / IN);

export function mountDetail(root: HTMLElement, o: DetailOptions): { open: (entry: CatalogEntry) => void; close: () => void } {
  const close = () => { root.hidden = true; };
  root.addEventListener("click", (e) => { if (e.target === root) close(); });
  window.addEventListener("keydown", (e) => { if (e.key === "Escape" && !root.hidden) close(); });

  const open = (entry: CatalogEntry) => {
    const { product, asset } = entry;
    const [w, h, d] = product.dimensionsM;
    root.hidden = false;
    root.innerHTML = `
      <div class="sheet" role="dialog" aria-label="${esc(product.title)}">
        <button type="button" class="close" aria-label="Close">✕</button>
        <div class="preview"><img alt="" /></div>
        <div class="body">
          <div class="cat">${esc(product.category)}</div>
          <h2>${esc(product.title)}</h2>
          <div class="price">${product.styleTags.includes("price-not-provided") ? "Price not provided" : `$${product.priceUsd}`}<span> · ${esc(product.merchant || "Catalog")}</span></div>
          <dl>
            <dt>Size</dt><dd>${inches(w)}″ W × ${inches(d)}″ D × ${inches(h)}″ H</dd>
          </dl>
          ${product.sourceUrl ? `<div class="shop"><a href="${esc(product.sourceUrl)}" target="_blank" rel="noopener">View listing at ${esc(product.merchant || new URL(product.sourceUrl).host.replace(/^www\./, ""))} ↗</a></div>` : ""}
          <button type="button" class="add">Add to room</button>
        </div>
      </div>`;
    root.querySelector(".close")!.addEventListener("click", close);
    root.querySelector(".add")!.addEventListener("click", () => { o.onAdd(entry); close(); });
    const img = root.querySelector("img")!;
    o.thumbnail(entry, 320).then((url) => { if (url) img.src = url; });
  };

  return { open, close };
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
