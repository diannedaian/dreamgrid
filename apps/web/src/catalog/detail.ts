// Product detail panel: bigger preview, size and price, and a slot for Linda's shopping info.
import type { CatalogEntry } from "./catalog";
import { priceKnown } from "../commerce/budget";

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
          <div class="price">${priceKnown(product) ? `$${product.priceUsd}` : ""}<span>${esc(product.merchant || "Catalog")}</span></div>
          <dl>
            <dt>Width</dt><dd>${inches(w)}″ W</dd>
            <dt>Depth</dt><dd>${inches(d)}″ D</dd>
            <dt>Height</dt><dd>${inches(h)}″ H</dd>
          </dl>
          ${product.sourceUrl ? `<div class="shop"><a href="${esc(product.sourceUrl)}" target="_blank" rel="noopener">View at ${esc(shortMerchant(product))} ↗</a></div>` : ""}
          ${asset?.disclosure ? `<details><summary>About this model</summary><p class="disclosure">${esc(priceKnown(product) ? asset.disclosure : asset.disclosure.replace(/Price not provided[^.]*\.\s*/gi, ""))}</p></details>` : ""}
          <button type="button" class="add">${!asset && product.styleTags.includes("model-pending") ? "Generate model" : "Add to room"}</button>
        </div>
      </div>`;
    root.querySelector(".close")!.addEventListener("click", close);
    root.querySelector(".add")!.addEventListener("click", () => { o.onAdd(entry); close(); });
    const img = root.querySelector("img")!;
    // Real product photo when the listing has one; the rendered model is the fallback.
    const rendered = () => o.thumbnail(entry, 320).then((url) => { if (url) img.src = url; });
    if (product.imageUrl) { img.referrerPolicy = "no-referrer"; img.onerror = () => { img.onerror = null; void rendered(); }; img.src = product.imageUrl; }
    else void rendered();
  };

  return { open, close };
}

function shortMerchant(p: { merchant: string; sourceUrl: string }): string {
  const host = new URL(p.sourceUrl).host.replace(/^www\./, "");
  return (p.merchant || host).split(" · ")[0].trim() || host;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
