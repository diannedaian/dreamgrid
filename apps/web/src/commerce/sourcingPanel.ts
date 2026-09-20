// Source products tab: search or paste a listing, then hand the pick to the Generate panel with
// its photo, link, price and listed size prefilled. No intermediate form.
import type { ProductCategory } from "@dreamgrid/contracts";
import { importProductFromUrl, searchProducts, REGIONS, type ProductDraft, type ProductSearchQuery, type Region } from "../lib/commerce/productSourcing";
import type { ImportSeed } from "../catalog/importer";
import { PRODUCT_CATEGORIES, mergeDrafts } from "./draftToProduct";
import { rankSearchResults } from "./productSearch";
import { guessCategory } from "./productText";
import { toMeters } from "./units";
import { formatUsd } from "./format";

export type SourcingPanelOptions = {
  /** Open the shared Generate panel with everything the listing knows prefilled. */
  onAddFurniture: (seed: ImportSeed) => void;
  remainingBudgetUsd: () => number | undefined;
  fetchDraft?: (url: string, options: { titleHint?: string }) => Promise<ProductDraft>;
  /** A render of the 3D model DreamGrid already built for this listing, if there is one. */
  renderedThumbnail?: (draft: ProductDraft) => Promise<string | null>;
  search?: (query: ProductSearchQuery) => Promise<import("../lib/commerce/productSourcing").ProductSearchResult>;
};

const esc = (s: string) => s.replace(/[&<>\"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const http = (s: string) => { try { const u = new URL(s); return ["http:", "https:"].includes(u.protocol) && !u.username && !u.password; } catch { return false; } };
const knownPrice = (n?: number) => n !== undefined && Number.isFinite(n) && n > 0;

/** Quiet category silhouettes for listings with no photo and no model yet. Never a "not available" label. */
const SILHOUETTE: Record<string, string> = {
  bed: '<path d="M3 18v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6"/><path d="M3 18h18"/><path d="M6 10V7a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v3"/><path d="M8 10h8"/>',
  desk: '<path d="M3 8h18"/><path d="M5 8v10M19 8v10"/><path d="M13 8v5h6"/>',
  chair: '<path d="M7 4h7a2 2 0 0 1 2 2v6H7z"/><path d="M5 12h12v3H5z"/><path d="M6 15v5M16 15v5"/>',
  shelf: '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M4 9h16M4 15h16"/>',
  lamp: '<path d="M9 3h6l3 8H6z"/><path d="M12 11v8"/><path d="M8 21h8"/>',
  decor: '<circle cx="12" cy="10" r="6"/><path d="M12 16v5M8 21h8"/>',
  misc: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 12h16M12 4v16"/>',
};
const silhouette = (category?: string) => `<svg class="silhouette" viewBox="0 0 24 24" aria-hidden="true">${SILHOUETTE[category ?? ""] ?? SILHOUETTE.misc}</svg>`;

/** Everything a draft can contribute; missing fields stay missing so the panel keeps them blank. */
export function seedFromDraft(draft: ProductDraft): ImportSeed {
  return {
    sourceUrl: draft.sourceUrl,
    title: draft.title,
    merchant: draft.merchant,
    imageUrl: draft.imageUrl && http(draft.imageUrl) ? draft.imageUrl : undefined,
    priceUsd: knownPrice(draft.priceUsd) ? draft.priceUsd : undefined,
    dimensionsM: draft.dimensionsM,
    category: draft.category,
    styleTags: draft.styleTags,
    colorTags: draft.colorTags,
  };
}

export function mountSourcingPanel(root: HTMLElement, o: SourcingPanelOptions) {
  root.innerHTML = `<form class="address"><input aria-label="Search or product link" placeholder="Search furniture, or paste a link" /><button type="submit" class="find">Search</button></form>
    <details class="refine"><summary>Region, budget and size</summary>
      <label>Category<select class="category"><option value="">Auto</option>${PRODUCT_CATEGORIES.map(c => `<option>${c}</option>`).join("")}</select></label>
      <label>Max USD<input class="price" type="number" min="0" step="0.01" placeholder="Remaining budget" /></label>
      <label>Shop in<select class="region">${REGIONS.map(r => `<option value="${r.value}">${r.label}</option>`).join("")}</select></label>
      <div class="size">Fits within (inches)<input class="w" aria-label="Search width" type="number" min="0" placeholder="Width" /><input class="d" aria-label="Search depth" type="number" min="0" placeholder="Depth" /><input class="h" aria-label="Search height" type="number" min="0" placeholder="Height" /></div>
    </details><div class="results"><p class="empty">Search or paste a listing. Pick one and it opens in Generate with its photo, link and size filled in.</p></div>`;
  const q = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const results = q(".results"), searchButton = q<HTMLButtonElement>(".address button");
  const fetchDraft = o.fetchDraft ?? importProductFromUrl;
  const search = o.search ?? searchProducts;
  let priceTouched = false;
  q(".price").addEventListener("input", () => { priceTouched = true; });

  /** Listings rarely include dimensions; read the page once (no AI spend) before handing off. */
  const handOff = async (draft: ProductDraft, alreadyRead = false) => {
    let merged = draft;
    if (!alreadyRead && draft.missing.length && http(draft.sourceUrl)) merged = mergeDrafts(draft, await fetchDraft(draft.sourceUrl, { titleHint: draft.title }));
    o.onAddFurniture(seedFromDraft(merged));
  };
  const card = (draft: ProductDraft, reasons: string[]) => {
    const el = document.createElement("div"); el.className = "hit";
    const dims = draft.dimensionsM?.map(m => Math.round(m / .0254));
    el.innerHTML = `<div class="pic">${silhouette(draft.category)}</div><div class="info">
      ${http(draft.sourceUrl) ? `<a class="title" href="${esc(draft.sourceUrl)}" target="_blank" rel="noopener">${esc(draft.title || draft.sourceUrl)}</a>` : `<span class="title">${esc(draft.title || "Product")}</span>`}
      <div class="meta">${esc(draft.merchant || "")}${knownPrice(draft.priceUsd) ? ` · ${formatUsd(draft.priceUsd!)}` : ""}</div>
      <div class="dims">${dims ? `${dims[0]} W × ${dims[2]} D × ${dims[1]} H in` : ""}</div>
      ${reasons.length ? `<p class="why">${esc(reasons.join(" · "))}</p>` : ""}
      <div class="actions"><button type="button" class="add">+ Add furniture</button><span class="st"></span></div></div>`;
    const photo = el.querySelector<HTMLElement>(".pic")!;
    const show = (src: string, alt: string) => {
      const image = new Image();
      image.alt = alt; image.referrerPolicy = "no-referrer"; // not lazy: a detached lazy image never loads, so it never errors either
      image.onload = () => photo.replaceChildren(image);
      image.src = src;
      return image;
    };
    // Store photo first; if the store blocks it (or never gave one) show DreamGrid's own render of
    // the model built for this listing; failing that the category silhouette simply stays.
    const rendered = async () => { const url = await o.renderedThumbnail?.(draft).catch(() => null); if (url) show(url, `${draft.title || "Product"} (3D model)`); };
    if (draft.imageUrl && http(draft.imageUrl)) show(draft.imageUrl, draft.title || "Product photo").onerror = () => void rendered();
    else void rendered();
    const button = el.querySelector<HTMLButtonElement>("button")!, status = el.querySelector<HTMLElement>(".st")!;
    button.addEventListener("click", async () => {
      button.disabled = true; status.textContent = "Reading the listing…";
      try { await handOff(draft); status.textContent = ""; }
      catch (e) { status.textContent = (e as Error).message; }
      finally { button.disabled = false; }
    });
    return el;
  };
  q(".address").addEventListener("submit", async e => {
    e.preventDefault();
    const text = q<HTMLInputElement>(".address input").value.trim();
    if (!text) return;
    searchButton.disabled = true; results.textContent = "Searching…";
    try {
      if (http(text)) { await handOff(await fetchDraft(text, {}), true); results.innerHTML = `<p class="empty">Opened in Generate. Check the photo and sizes, then hit Generate.</p>`; return; }
      const remaining = o.remainingBudgetUsd();
      const price = q<HTMLInputElement>(".price");
      if (!priceTouched) price.value = remaining === undefined ? "" : String(Math.max(0, remaining));
      const dims = ["w", "h", "d"].map(axis => Number(q<HTMLInputElement>(`.${axis}`).value));
      const query: ProductSearchQuery = {
        category: q<HTMLSelectElement>(".category").value as ProductCategory || guessCategory(text) || "decor",
        keywords: text,
        region: q<HTMLSelectElement>(".region").value as Region,
        maxPriceUsd: price.value.trim() && Number.isFinite(Number(price.value)) ? Math.max(0, Number(price.value)) : undefined,
        targetDimensionsM: dims.every(n => Number.isFinite(n) && n > 0) ? dims.map(n => toMeters(n, "in")) as [number, number, number] : undefined,
      };
      const result = await search(query);
      const note = document.createElement("p"); note.className = "summary";
      note.textContent = `${result.source === "fixture" ? "Demo fixtures, not live listings." : result.source === "offline" ? "Search is unavailable right now. Paste a product link instead." : result.provider === "serpapi" ? "Google Shopping listings; confirm price and size." : "AI web search; confirm listing details."} ${result.note || ""}`;
      results.replaceChildren(note, ...rankSearchResults(query, result.results).map(r => card(r.draft, r.reasons)));
      if (!result.results.length) results.append("No results. Try fewer constraints, or paste a product link.");
    } catch (e) { results.textContent = (e as Error).message; }
    finally { searchButton.disabled = false; }
  });
}
