// Collapsible right drawer: a small "browser" for furniture. Type a search or paste a product link;
// results show as cards you can open or add to the catalog (bottom bar). Searches and link reads go
// through Linda's product-sourcing API (services/api: Google Shopping via SerpAPI, page reader, AI
// fallback) and her ranking; "Add your own product" opens a form for typing one in. The ★ pane is
// Cindy's shopping agent (OpenAI web search) with size limits, typed or measured in the room.
import type { Product, ProductCategory } from "@dreamgrid/contracts";

import type { ModelOutcome } from "../commerce/catalogAdd";
import { productIdFor } from "../commerce/catalogAdd";
import { PRODUCT_CATEGORIES, mergeDrafts, productFromCompleteDraft } from "../commerce/draftToProduct";
import { formatUsd } from "../commerce/format";
import { mountProductForm } from "../commerce/productForm";
import { rankSearchResults } from "../commerce/productSearch";
import { guessCategory } from "../commerce/productText";
import { toMeters } from "../commerce/units";
import {
  REGIONS,
  importProductFromUrl,
  merchantFromUrl,
  searchProducts,
  type ProductDraft,
  type ProductSearchQuery,
  type ProductSearchResult,
  type Region,
} from "../lib/commerce/productSourcing";

export type ShopBarOptions = {
  /** Put a finished product in the catalog; `model` settles when the 3D model attempt is done. */
  addProduct: (product: Product) => { product: Product; model: Promise<ModelOutcome> };
  /** Start a one-shot two-point measurement; resolves with meters. */
  measure: (cb: (meters: number) => void) => void;
  /** What's left of the budget, to prefill the price limit (undefined when no budget is set). */
  remainingBudgetUsd?: () => number | undefined;
  /** Called when this drawer opens, so the budget drawer can close (they share the right edge). */
  onOpen?: () => void;
  /** Injected for tests; default to the real API adapters. */
  search?: (query: ProductSearchQuery) => Promise<ProductSearchResult>;
  fetchDraft?: (url: string, options: { titleHint?: string }) => Promise<ProductDraft>;
};

export type ShopBar = { setOpen: (on: boolean) => void };

type Hit = { url: string; title: string; snippet?: string; host: string; price?: number; image?: string; dimensionsText?: string; description?: string; fit?: "fits" | "unsure" | "too big"; why?: string; dimensionsIn?: number[] | null };

const IN = 0.0254;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const money = (n?: number) => (n ? `$${Math.round(n).toLocaleString()}` : "");
const dimsLine = (h: Hit) => h.dimensionsIn ? `${h.dimensionsIn.map((n) => Math.round(n)).join('" × ')}"` : (h.dimensionsText || "").replace(/\\"/g, '"').replace(/"\s*"/g, '"').split(" | ").slice(0, 2).join(" · ");
const draftDims = (d: ProductDraft) => d.dimensionsM ? `${Math.round(d.dimensionsM[0] / IN)}″ × ${Math.round(d.dimensionsM[2] / IN)}″ × ${Math.round(d.dimensionsM[1] / IN)}″` : "size not listed";
const isHttp = (s: string) => /^https?:\/\//.test(s);

const SOURCE_LABEL = {
  live: "Results from AI web search. Confirm price and size on the store page.",
  fixture: "Demo results from a fixture, not live listings.",
  offline: "Search is unavailable right now. Is the API running? (pnpm dev at the repo root starts it.)",
} as const;
const sourceLabel = (r: ProductSearchResult) =>
  r.provider === "serpapi" ? "Google Shopping listings. Pick one and its link is read for dimensions." : SOURCE_LABEL[r.source];

/** A ★ agent pick as a draft, so it takes the same road into the catalog as a search hit. */
function draftFromHit(h: Hit): ProductDraft {
  const d = h.dimensionsIn && h.dimensionsIn.length === 3 && h.dimensionsIn.every((n) => n > 0) ? h.dimensionsIn : null;
  const dimensionsM = d ? ([toMeters(d[0], "in"), toMeters(d[2], "in"), toMeters(d[1], "in")] as [number, number, number]) : undefined;
  const draft: ProductDraft = {
    sourceUrl: h.url, title: h.title || undefined, priceUsd: h.price || undefined, merchant: h.host || merchantFromUrl(h.url),
    imageUrl: h.image || undefined, dimensionsM, category: guessCategory(h.title || ""), styleTags: [], colorTags: [],
    confidence: 0.4, extractionMethod: "llm", missing: [],
  };
  draft.missing = (["title", "priceUsd", "imageUrl", "dimensionsM", "category"] as const).filter((k) => draft[k] === undefined);
  return draft;
}

export function mountShopBar(bar: HTMLElement, o: ShopBarOptions): ShopBar {
  const search = o.search ?? searchProducts;
  const fetchDraft = o.fetchDraft ?? importProductFromUrl;
  const toggle = document.getElementById("shop-toggle") as HTMLButtonElement;
  toggle.hidden = false;
  bar.hidden = false;
  document.body.classList.add("has-rightbar");
  const setOpen = (on: boolean) => {
    if (on) o.onOpen?.();
    document.body.classList.toggle("rightbar-open", on);
    if (on) setTimeout(() => address.focus(), 250);
  };
  toggle.addEventListener("click", () => setOpen(true));

  bar.innerHTML = `
    <div class="head">
      <button type="button" class="collapse" title="Close">›</button>
      <h2>Shop</h2>
      <button type="button" class="star" title="Shopping agent" aria-label="Shopping agent">★</button>
    </div>
    <form class="address"><span class="glyph">⌕</span><input type="text" placeholder="Search furniture, or paste a link" autocomplete="off" /></form>
    <div class="under">
      <button type="button" class="textlink add-own">+ Add your own product</button>
      <button type="button" class="textlink refine-toggle">Refine ▾</button>
    </div>
    <div class="refine" hidden>
      <label><span>Type</span><select class="r-category"><option value="">auto</option>${PRODUCT_CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join("")}</select></label>
      <label><span>Max $</span><input type="number" min="0" step="1" class="r-price" placeholder="any" /></label>
      <label><span>Shop in</span><select class="r-region">${REGIONS.map((r) => `<option value="${r.value}">${esc(r.label)}</option>`).join("")}</select></label>
      <div class="size"><span>Size (in)</span><input type="number" min="1" step="1" class="r-w" placeholder="W" /><i>×</i><input type="number" min="1" step="1" class="r-d" placeholder="D" /><i>×</i><input type="number" min="1" step="1" class="r-h" placeholder="H" /></div>
    </div>
    <div class="pane browse">
      <div class="pform-host"></div>
      <div class="results"><p class="empty">Try “compact desk with drawers” or paste a product page. “Add to catalog” reads the listing's size and price and puts it in the catalog below, with a 3D model when one can be built.</p></div>
    </div>
    <div class="pane agent" hidden>
      <h3>Shopping agent</h3>
      <p class="sub">Describe what you want. It searches the web, reads the listings, and checks the fit.</p>
      <textarea class="ask" rows="3" placeholder="e.g. a narrow bookshelf in light wood under $120"></textarea>
      <div class="fits">
        <div class="lbl">Fits within <span class="sub">(optional, inches)</span></div>
        <label><span>Width</span><input type="number" min="1" step="1" data-dim="w" /><button type="button" class="measure" data-dim="w">measure</button></label>
        <label><span>Depth</span><input type="number" min="1" step="1" data-dim="d" /><button type="button" class="measure" data-dim="d">measure</button></label>
        <label><span>Height</span><input type="number" min="1" step="1" data-dim="h" /><button type="button" class="measure" data-dim="h">measure</button></label>
      </div>
      <div class="agent-actions"><button type="button" class="find">Find furniture</button><span class="status" hidden></span></div>
      <div class="picks"></div>
    </div>`;
  const q = <T extends HTMLElement>(sel: string) => bar.querySelector<T>(sel)!;
  const address = q<HTMLInputElement>(".address input");
  const browse = q(".pane.browse"), results = q(".results"), agent = q(".pane.agent"), star = q<HTMLButtonElement>(".star");
  const refine = q(".refine"), refineToggle = q<HTMLButtonElement>(".refine-toggle");
  q(".collapse").addEventListener("click", () => setOpen(false));

  // ── manual entry form (under the search bar) ───────────────────────────────
  const form = mountProductForm(q(".pform-host"), {
    fetchDraft,
    onProductCreated: (product) => {
      const { model } = o.addProduct(product);
      results.replaceChildren(addedCard(product, model));
    },
  });
  const addOwn = q<HTMLButtonElement>(".add-own");
  addOwn.addEventListener("click", () => { form.toggle(); addOwn.classList.toggle("on", form.isOpen); });

  // ── refine row (category / price / region / size) ─────────────────────────
  refineToggle.addEventListener("click", () => {
    refine.hidden = !refine.hidden;
    refineToggle.textContent = refine.hidden ? "Refine ▾" : "Refine ▴";
  });
  const priceInput = q<HTMLInputElement>(".r-price");
  let priceTouched = false;
  priceInput.addEventListener("input", () => (priceTouched = true));

  // ── star: switch between the browser and the agent ─────────────────────────
  let agentOn = false;
  star.addEventListener("click", () => {
    agentOn = !agentOn;
    star.classList.toggle("on", agentOn);
    agent.hidden = !agentOn; browse.hidden = agentOn;
    q(".under").hidden = agentOn; if (agentOn) refine.hidden = true;
    if (agentOn) q<HTMLTextAreaElement>(".ask").focus();
  });

  // ── adding: draft → (read the link for gaps) → Product → catalog (+ 3D model) ──
  /**
   * Listings rarely state dimensions, so the link is read first (page data or AI lookup). If the
   * merged draft is complete it becomes a Product; otherwise the form opens with what we have.
   */
  const addDraft = async (draft: ProductDraft, st: HTMLElement, btn: HTMLButtonElement, alreadyRead = false) => {
    btn.disabled = true; st.className = "st working";
    let merged = draft;
    if (draft.missing.length > 0 && !alreadyRead) {
      st.textContent = "Reading the listing…";
      merged = mergeDrafts(draft, await fetchDraft(draft.sourceUrl, { titleHint: draft.title }));
    }
    const product = productFromCompleteDraft(merged, await productIdFor(merged.sourceUrl));
    if (!product) {
      const still = merged.missing.filter((m) => m !== "imageUrl");
      st.className = "st"; st.textContent = `Still needed: ${still.join(", ") || "a check"}. Finish it in the form above.`;
      btn.disabled = false;
      form.open(merged); addOwn.classList.add("on");
      browse.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const { model } = o.addProduct(product);
    st.className = "st ok"; st.textContent = "Added to catalog · building 3D model…";
    const outcome = await model;
    st.textContent = `Added to catalog · ${outcome.note}`;
  };

  const addedCard = (p: Product, model: Promise<ModelOutcome>): HTMLElement => {
    const el = document.createElement("div");
    el.className = "hit";
    el.innerHTML = `
      <div class="pic">${isHttp(p.imageUrl) ? `<img src="${esc(p.imageUrl)}" alt="" loading="lazy" />` : ""}</div>
      <div class="info">
        <span class="title">${esc(p.title)}</span>
        <div class="meta"><span class="host">${esc(p.merchant)}</span> <span class="price">${p.priceUsd ? formatUsd(p.priceUsd) : "unpriced"}</span></div>
        <div class="dims">${Math.round(p.dimensionsM[0] / IN)}″ × ${Math.round(p.dimensionsM[2] / IN)}″ × ${Math.round(p.dimensionsM[1] / IN)}″</div>
        <div class="actions"><span class="st ok">Added to catalog · building 3D model…</span></div>
      </div>`;
    const st = el.querySelector<HTMLElement>(".st")!;
    model.then((m) => (st.textContent = `Added to catalog · ${m.note}`));
    return el;
  };

  const draftCard = (d: ProductDraft, reasons: string[] = [], over = 0, alreadyRead = false): HTMLElement => {
    const el = document.createElement("div");
    el.className = `hit${over > 0 ? " over" : ""}`;
    el.innerHTML = `
      <a class="pic" href="${esc(d.sourceUrl)}" target="_blank" rel="noopener">${d.imageUrl && isHttp(d.imageUrl) ? `<img src="${esc(d.imageUrl)}" alt="" loading="lazy" />` : ""}</a>
      <div class="info">
        <a class="title" href="${esc(d.sourceUrl)}" target="_blank" rel="noopener">${esc(d.title || d.sourceUrl)}</a>
        <div class="meta"><span class="host">${esc(d.merchant || merchantFromUrl(d.sourceUrl))}</span> <span class="price">${d.priceUsd !== undefined ? formatUsd(d.priceUsd) : "price unknown"}</span>${over > 0 ? `<span class="fit bad">${formatUsd(over)} over</span>` : ""}</div>
        ${reasons.length ? `<div class="why">${reasons.map(esc).join(" · ")}</div>` : ""}
        <div class="dims">${draftDims(d)}${d.note ? ` · ${esc(d.note)}` : ""}</div>
        <div class="actions"><button type="button" class="add">Add to catalog</button><span class="st"></span></div>
      </div>`;
    const add = el.querySelector<HTMLButtonElement>(".add")!, st = el.querySelector<HTMLElement>(".st")!;
    add.addEventListener("click", () => addDraft(d, st, add, alreadyRead).catch((e) => { st.className = "st err"; st.textContent = (e as Error).message; add.disabled = false; }));
    return el;
  };

  // ── address bar: search, or a pasted link ──────────────────────────────────
  const buildQuery = (text: string): ProductSearchQuery => {
    const num = (sel: string) => Number(q<HTMLInputElement>(sel).value);
    const picked = q<HTMLSelectElement>(".r-category").value as ProductCategory | "";
    const guessed = guessCategory(text);
    const category = picked || guessed || "decor";
    // "small white desk" → keywords "small white", category desk (the API joins them again).
    const keywords = guessed && !picked ? text.replace(new RegExp(`\\b${guessed}s?\\b\\s*$`, "i"), "").trim() : text;
    const dims = [num(".r-w"), num(".r-h"), num(".r-d")];
    const price = priceInput.value.trim() !== "" ? Number(priceInput.value) : undefined;
    return {
      category,
      keywords: keywords || undefined,
      targetDimensionsM: dims.every((n) => Number.isFinite(n) && n > 0) ? [toMeters(dims[0], "in"), toMeters(dims[1], "in"), toMeters(dims[2], "in")] : undefined,
      maxPriceUsd: price !== undefined && price >= 0 ? price : undefined,
      region: q<HTMLSelectElement>(".r-region").value as Region,
    };
  };

  q(".address").addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = address.value.trim();
    if (!v) return;
    if (agentOn) star.click();
    form.close(); addOwn.classList.remove("on");
    try {
      if (isHttp(v)) {
        results.innerHTML = `<p class="empty">Reading the page for its size and price…</p>`;
        const draft = await fetchDraft(v, {});
        const card = draftCard(draft, [], 0, true);
        results.replaceChildren(card);
        // A pasted link means "I want this one": add it straight away.
        card.querySelector<HTMLButtonElement>(".add")!.click();
        return;
      }
      // The remaining budget is the default price limit until the user types their own.
      const remaining = o.remainingBudgetUsd?.();
      if (!priceTouched) priceInput.value = remaining !== undefined && remaining > 0 ? String(Math.floor(remaining)) : "";
      const query = buildQuery(v);
      results.innerHTML = `<p class="empty">Searching listings…</p>`;
      const result = await search(query);
      const ranked = rankSearchResults(query, result.results);
      const note = document.createElement("p"); note.className = "summary";
      const limit = query.maxPriceUsd !== undefined ? ` Under ${formatUsd(query.maxPriceUsd)}${!priceTouched && remaining !== undefined ? " (your remaining budget; change it under Refine)" : ""}.` : "";
      note.textContent = `${sourceLabel(result)}${result.note ? ` ${result.note}` : ""}${limit}`;
      if (!ranked.length) {
        results.replaceChildren(note, Object.assign(document.createElement("p"), { className: "empty", textContent: "No results. Try fewer constraints, or add the product by link or by hand." }));
        return;
      }
      results.replaceChildren(note, ...ranked.map((r) => draftCard(r.draft, r.reasons, r.overBudgetUsd)));
    } catch (err) {
      results.innerHTML = `<p class="empty err">${esc((err as Error).message)}</p>`;
    }
  });

  // ── agent (Cindy's): measurements + find ──────────────────────────────────
  const hitCard = (h: Hit): HTMLElement => {
    const el = document.createElement("div");
    el.className = "hit";
    const fit = h.fit ? `<span class="fit ${h.fit === "fits" ? "ok" : h.fit === "too big" ? "bad" : "meh"}">${h.fit === "unsure" ? (h.dimensionsIn ? "check size" : "size not listed") : h.fit}</span>` : "";
    el.innerHTML = `
      <a class="pic" href="${esc(h.url)}" target="_blank" rel="noopener">${h.image ? `<img src="${esc(h.image)}" alt="" loading="lazy" />` : ""}</a>
      <div class="info">
        <a class="title" href="${esc(h.url)}" target="_blank" rel="noopener">${esc(h.title || h.url)}</a>
        <div class="meta"><span class="host">${esc(h.host)}</span> <span class="price">${money(h.price)}</span> ${fit}</div>
        ${h.why ? `<div class="why">${esc(h.why)}</div>` : h.snippet ? `<div class="why">${esc(h.snippet.slice(0, 140))}</div>` : ""}
        <div class="dims">${esc(dimsLine(h))}</div>
        <div class="actions"><button type="button" class="add">Add to catalog</button><span class="st"></span></div>
      </div>`;
    const add = el.querySelector<HTMLButtonElement>(".add")!, st = el.querySelector<HTMLElement>(".st")!;
    add.addEventListener("click", () => addDraft(draftFromHit(h), st, add).catch((e) => { st.className = "st err"; st.textContent = (e as Error).message; add.disabled = false; }));
    return el;
  };
  for (const btn of bar.querySelectorAll<HTMLButtonElement>(".measure")) {
    btn.addEventListener("click", () => {
      const input = q<HTMLInputElement>(`input[data-dim="${btn.dataset.dim}"]`);
      btn.textContent = "click two points…"; btn.disabled = true;
      o.measure((m) => { input.value = String(Math.round(m / IN)); btn.textContent = "measure"; btn.disabled = false; });
    });
  }
  const find = q<HTMLButtonElement>(".find"), status = q(".status"), picks = q(".picks");
  const run = async () => {
    const prompt = q<HTMLTextAreaElement>(".ask").value.trim();
    if (!prompt) { q<HTMLTextAreaElement>(".ask").focus(); return; }
    const fitsIn: Record<string, number> = {};
    for (const inp of bar.querySelectorAll<HTMLInputElement>("input[data-dim]")) if (Number(inp.value) > 0) fitsIn[inp.dataset.dim!] = Number(inp.value);
    find.disabled = true; status.hidden = false; status.className = "status working"; status.textContent = "Searching the web…";
    const steps = ["Reading listings…", "Checking sizes…", "Ranking…"]; let i = 0;
    const tick = window.setInterval(() => { status.textContent = steps[Math.min(steps.length - 1, i++)]; }, 5000);
    try {
      const res = await fetch("/api/shop-agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, fitsIn }) });
      const json = (await res.json()) as { summary: string; picks: Hit[]; cost?: number; cached?: boolean; error?: string };
      if (!res.ok || json.error) throw new Error(json.error || "The agent hit an error");
      status.className = "status"; status.textContent = json.cached ? "from cache" : json.cost != null ? `cost $${json.cost.toFixed(3)}` : "";
      picks.replaceChildren();
      const sum = document.createElement("p"); sum.className = "summary"; sum.textContent = json.summary; picks.appendChild(sum);
      if (!json.picks.length) { const p = document.createElement("p"); p.className = "empty"; p.textContent = "No good matches. Try loosening the request."; picks.appendChild(p); }
      for (const h of json.picks) picks.appendChild(hitCard(h));
    } catch (e) {
      status.className = "status err"; status.textContent = (e as Error).message;
    } finally { clearInterval(tick); find.disabled = false; }
  };
  find.addEventListener("click", run);
  q<HTMLTextAreaElement>(".ask").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); run(); } });

  return { setOpen };
}
