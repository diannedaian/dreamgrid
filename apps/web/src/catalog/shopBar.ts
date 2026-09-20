// Collapsible right drawer: the shopping agent. Describe what you want (or paste a product link), add
// optional size limits (typed, or measured with two clicks in the room), and get real product pages
// with price and size (OpenAI web search) as cards you can open or add to the room. A second tab shows
// the shopping list for what's in the room.
import { copyText } from "../interactions/share";
import { listHtml, type ShoppingRow } from "./shoppingList";
import { mountSourcingPanel } from "../commerce/sourcingPanel";
import type { ImportSeed } from "./importer";

export type ShopBarOptions = {
  /** Open the shared image/size-review flow with this product link prefilled. */
  addFromUrl: (url: string) => void;
  /** Start a one-shot two-point measurement; resolves with meters. */
  measure: (cb: (meters: number) => void) => void;
  /** What's in the room, grouped by product (for the Shopping list tab). */
  rows: () => ShoppingRow[];
  /** Shareable shopping-list page for the current plan. */
  listUrl: () => string;
  /** Open the Generate panel seeded from a sourced listing (photo, link, price, size). */
  addFurniture: (seed: ImportSeed) => void;
  remainingBudgetUsd: () => number | undefined;
  onOpen?: () => void;
};

type Hit = { url: string; title: string; snippet?: string; host: string; price?: number; image?: string; dimensionsText?: string; description?: string; fit?: "fits" | "unsure" | "too big"; why?: string; dimensionsIn?: number[] | null };

const INCH_M = 0.0254;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const money = (n?: number) => (n ? `$${Math.round(n).toLocaleString()}` : "");
const dimsLine = (h: Hit) => h.dimensionsIn ? `${h.dimensionsIn.map((n) => Math.round(n)).join('" × ')}"` : (h.dimensionsText || "").replace(/\\"/g, '"').replace(/"\s*"/g, '"').split(" | ").slice(0, 2).join(" · ");

export function mountShopBar(bar: HTMLElement, o: ShopBarOptions): { refresh: () => void; setOpen: (on: boolean) => void } {
  const toggle = document.getElementById("shop-toggle") as HTMLButtonElement;
  toggle.hidden = false;
  bar.hidden = false;
  document.body.classList.add("has-rightbar");
  const setOpen = (on: boolean) => { if (on) o.onOpen?.(); document.body.classList.toggle("rightbar-open", on); if (on) { refresh(); if (tab === "agent") setTimeout(() => ask.focus(), 250); } };
  toggle.addEventListener("click", () => setOpen(true));

  bar.innerHTML = `
    <div class="head">
      <button type="button" class="collapse" title="Close">›</button>
      <h2>Shopping</h2>
    </div>
    <div class="tabs" role="tablist">
      <button type="button" class="tab" data-tab="source" role="tab">Source products</button>
      <button type="button" class="tab on" data-tab="agent" role="tab">Shopping agent</button>
      <button type="button" class="tab" data-tab="list" role="tab">Shopping list</button>
    </div>
    <div class="pane source" hidden></div>
    <div class="pane list" hidden>
      <div class="list-body"></div>
      <div class="agent-actions"><a class="ghost page" href="#" target="_blank" rel="noopener">Open as a page ↗</a><button type="button" class="ghost copy-list">Copy list link</button></div>
    </div>
    <div class="pane agent">
      <p class="sub">Describe what you want, or paste a product link. It searches the web, reads the listings, and checks the fit.</p>
      <textarea class="ask" rows="3" placeholder="e.g. a narrow bookshelf in light wood under $120"></textarea>
      <div class="fits">
        <div class="lbl">Fits within <span class="sub">(optional, inches)</span></div>
        <label><span>Width</span><input type="text" inputmode="numeric" pattern="[0-9]*" data-dim="w" /><button type="button" class="measure" data-dim="w">measure</button></label>
        <label><span>Depth</span><input type="text" inputmode="numeric" pattern="[0-9]*" data-dim="d" /><button type="button" class="measure" data-dim="d">measure</button></label>
        <label><span>Height</span><input type="text" inputmode="numeric" pattern="[0-9]*" data-dim="h" /><button type="button" class="measure" data-dim="h">measure</button></label>
      </div>
      <div class="agent-actions"><button type="button" class="find">Find furniture</button><span class="status" hidden></span></div>
      <div class="picks"></div>
    </div>`;
  const q = <T extends HTMLElement>(sel: string) => bar.querySelector<T>(sel)!;
  mountSourcingPanel(q(".pane.source"), { onAddFurniture: o.addFurniture, remainingBudgetUsd: o.remainingBudgetUsd });
  const ask = q<HTMLTextAreaElement>(".ask");
  q(".collapse").addEventListener("click", () => setOpen(false));

  // ── tabs ───────────────────────────────────────────────────────────────────
  let tab: "agent" | "list" | "source" = "agent";
  const panes = { agent: q(".pane.agent"), list: q(".pane.list"), source: q(".pane.source") };
  const refresh = () => {
    if (tab !== "list" || !document.body.classList.contains("rightbar-open")) return;
    q(".list-body").innerHTML = listHtml(o.rows());
    q<HTMLAnchorElement>(".page").href = o.listUrl();
  };
  for (const t of bar.querySelectorAll<HTMLButtonElement>(".tab")) {
    t.addEventListener("click", () => {
      tab = t.dataset.tab as "agent" | "list" | "source";
      for (const x of bar.querySelectorAll(".tab")) x.classList.toggle("on", x === t);
      panes.agent.hidden = tab !== "agent"; panes.list.hidden = tab !== "list"; panes.source.hidden = tab !== "source";
      refresh();
    });
  }
  q(".copy-list").addEventListener("click", async () => { const b = q(".copy-list"); const ok = await copyText(o.listUrl()); b.textContent = ok ? "Copied ✓" : "Copy failed"; setTimeout(() => (b.textContent = "Copy list link"), 1800); });

  // ── cards ──────────────────────────────────────────────────────────────────
  const card = (h: Hit): HTMLElement => {
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
        <div class="actions"><button type="button" class="add">Add to room</button><span class="st"></span></div>
      </div>`;
    const add = el.querySelector<HTMLButtonElement>(".add")!, st = el.querySelector<HTMLElement>(".st")!;
    add.addEventListener("click", () => {
      o.addFromUrl(h.url);
      st.className = "st"; st.textContent = "Upload an image and confirm size in the import panel.";
    });
    return el;
  };

  // ── agent: measurements + find ────────────────────────────────────────────
  for (const btn of bar.querySelectorAll<HTMLButtonElement>(".measure")) {
    btn.addEventListener("click", () => {
      const input = q<HTMLInputElement>(`input[data-dim="${btn.dataset.dim}"]`);
      btn.textContent = "click two points…"; btn.disabled = true;
      o.measure((m) => { input.value = String(Math.round(m / INCH_M)); btn.textContent = "measure"; btn.disabled = false; });
    });
  }
  const find = q<HTMLButtonElement>(".pane.agent .find"), status = q(".pane.agent .status"), picks = q(".picks");
  const run = async () => {
    const prompt = ask.value.trim();
    if (!prompt) { ask.focus(); return; }
    if (/^https?:\/\/\S+$/.test(prompt)) { // a pasted product link: preview it, no agent call
      find.disabled = true; status.hidden = false; status.className = "status working"; status.textContent = "Reading the page…";
      try {
        const res = await fetch(`/api/preview-product?url=${encodeURIComponent(prompt)}`);
        const p = (await res.json()) as Hit & { error?: string };
        if (!res.ok || p.error) throw new Error(p.error || "Couldn't read that page");
        status.hidden = true; picks.replaceChildren(card(p));
      } catch (e) { status.className = "status err"; status.textContent = (e as Error).message; }
      finally { find.disabled = false; }
      return;
    }
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
      for (const h of json.picks) picks.appendChild(card(h));
    } catch (e) {
      status.className = "status err"; status.textContent = (e as Error).message;
    } finally { clearInterval(tick); find.disabled = false; }
  };
  find.addEventListener("click", run);
  ask.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); run(); } });
  return { refresh, setOpen };
}
