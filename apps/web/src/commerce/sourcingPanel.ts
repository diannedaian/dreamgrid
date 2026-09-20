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
  search?: (query: ProductSearchQuery) => Promise<import("../lib/commerce/productSourcing").ProductSearchResult>;
};

const esc = (s: string) => s.replace(/[&<>\"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const http = (s: string) => { try { const u = new URL(s); return ["http:", "https:"].includes(u.protocol) && !u.username && !u.password; } catch { return false; } };
const knownPrice = (n?: number) => n !== undefined && Number.isFinite(n) && n > 0;

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
    el.innerHTML = `<div class="pic"><span class="photo-status">Photo unavailable</span></div><div class="info">
      ${http(draft.sourceUrl) ? `<a class="title" href="${esc(draft.sourceUrl)}" target="_blank" rel="noopener">${esc(draft.title || draft.sourceUrl)}</a>` : `<span class="title">${esc(draft.title || "Product")}</span>`}
      <div class="meta">${esc(draft.merchant || "")}${knownPrice(draft.priceUsd) ? ` · ${formatUsd(draft.priceUsd!)}` : ""}</div>
      <div class="dims">${dims ? `${dims[0]} W × ${dims[2]} D × ${dims[1]} H in` : ""}</div>
      ${reasons.length ? `<p class="why">${esc(reasons.join(" · "))}</p>` : ""}
      <div class="actions"><button type="button" class="add">+ Add furniture</button><span class="st"></span></div></div>`;
    const photo = el.querySelector<HTMLElement>(".pic")!;
    if (draft.imageUrl && http(draft.imageUrl)) {
      photo.replaceChildren(Object.assign(document.createElement("span"), { className: "photo-status", textContent: "Loading photo…" }));
      const image = new Image();
      image.alt = draft.title || "Product photo"; image.loading = "lazy"; image.referrerPolicy = "no-referrer";
      image.onload = () => { photo.querySelector(".photo-status")?.remove(); };
      image.onerror = () => { photo.replaceChildren(Object.assign(document.createElement("span"), { className: "photo-status", textContent: "Photo unavailable" })); };
      image.src = draft.imageUrl;
      photo.append(image);
    }
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
