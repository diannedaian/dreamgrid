// Collapsible right drawer: a small "browser" for furniture. Type a search or paste a product link;
// results show as cards you can open or add to the room. The ★ opens the shopping agent, which takes
// a plain-language request plus optional size limits (typed, or measured with two clicks in the room).
import { importProductUrl } from "./importer";

export type ShopBarOptions = {
  /** Import a product page into the catalog (opens its detail sheet on success). */
  addFromUrl: (url: string) => Promise<{ title: string }>;
  /** Start a one-shot two-point measurement; resolves with meters. */
  measure: (cb: (meters: number) => void) => void;
};

type Hit = { url: string; title: string; snippet?: string; host: string; price?: number; image?: string; dimensionsText?: string; description?: string; fit?: "fits" | "unsure" | "too big"; why?: string; dimensionsIn?: number[] | null };

const INCH_M = 0.0254;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const money = (n?: number) => (n ? `$${Math.round(n).toLocaleString()}` : "");

export function mountShopBar(bar: HTMLElement, o: ShopBarOptions): void {
  const toggle = document.getElementById("shop-toggle") as HTMLButtonElement;
  toggle.hidden = false;
  bar.hidden = false;
  document.body.classList.add("has-rightbar");
  const setOpen = (on: boolean) => { document.body.classList.toggle("rightbar-open", on); if (on) setTimeout(() => address.focus(), 250); };
  toggle.addEventListener("click", () => setOpen(true));

  bar.innerHTML = `
    <div class="head">
      <button type="button" class="collapse" title="Close">›</button>
      <h2>Shop</h2>
      <button type="button" class="star" title="Shopping agent" aria-label="Shopping agent">★</button>
    </div>
    <form class="address"><span class="glyph">⌕</span><input type="text" placeholder="Search furniture, or paste a link" autocomplete="off" /></form>
    <div class="pane browse">
      <p class="empty">Try “compact desk with drawers” or paste a product page. Results open in a new tab; “Add to room” builds a 3D model from the listing.</p>
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
  const browse = q(".pane.browse"), agent = q(".pane.agent"), star = q<HTMLButtonElement>(".star");
  q(".collapse").addEventListener("click", () => setOpen(false));

  // ── star: switch between the browser and the agent ─────────────────────────
  let agentOn = false;
  star.addEventListener("click", () => {
    agentOn = !agentOn;
    star.classList.toggle("on", agentOn);
    agent.hidden = !agentOn; browse.hidden = agentOn;
    if (agentOn) q<HTMLTextAreaElement>(".ask").focus();
  });

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
        <div class="dims">${esc((h.dimensionsIn ? `${h.dimensionsIn.map((n) => Math.round(n)).join('" × ')}"` : h.dimensionsText?.split(" | ").slice(0, 2).join(" · ")) || "")}</div>
        <div class="actions"><button type="button" class="add">Add to room</button><span class="st"></span></div>
      </div>`;
    const add = el.querySelector<HTMLButtonElement>(".add")!, st = el.querySelector<HTMLElement>(".st")!;
    add.addEventListener("click", async () => {
      add.disabled = true; st.className = "st working"; st.textContent = "Building model…";
      try { const r = await o.addFromUrl(h.url); st.className = "st ok"; st.textContent = `Added “${r.title}”`; }
      catch (e) { st.className = "st err"; st.textContent = (e as Error).message; add.disabled = false; }
    });
    return el;
  };

  /** Fill in image / price / dimensions for a plain search hit (scrape only; no API cost). */
  const enrich = async (h: Hit, el: HTMLElement) => {
    try {
      const res = await fetch(`/api/preview-product?url=${encodeURIComponent(h.url)}`);
      if (!res.ok) return;
      const p = (await res.json()) as Hit;
      if (p.image) el.querySelector(".pic")!.innerHTML = `<img src="${esc(p.image)}" alt="" loading="lazy" />`;
      if (p.price) el.querySelector(".price")!.textContent = money(p.price);
      if (p.title) el.querySelector(".title")!.textContent = p.title;
      if (p.dimensionsText) el.querySelector(".dims")!.textContent = p.dimensionsText.split(" | ").slice(0, 2).join(" · ");
    } catch { /* leave the plain card */ }
  };

  // ── address bar: search, or a pasted link ──────────────────────────────────
  q(".address").addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = address.value.trim();
    if (!v) return;
    if (agentOn) star.click();
    browse.innerHTML = `<p class="empty">Searching…</p>`;
    try {
      if (/^https?:\/\//.test(v)) {
        const res = await fetch(`/api/preview-product?url=${encodeURIComponent(v)}`);
        const p = (await res.json()) as Hit & { error?: string };
        if (!res.ok || p.error) throw new Error(p.error || "Couldn't read that page");
        browse.replaceChildren(card(p));
        return;
      }
      const res = await fetch(`/api/search-products?q=${encodeURIComponent(v)}`);
      const json = (await res.json()) as { hits: Hit[]; error?: string };
      if (!res.ok || json.error) throw new Error(json.error || "Search failed");
      if (!json.hits.length) { browse.innerHTML = `<p class="empty">Nothing found. Try different words.</p>`; return; }
      browse.replaceChildren(...json.hits.map((h) => { const el = card(h); void enrich(h, el); return el; }));
    } catch (err) {
      browse.innerHTML = `<p class="empty err">${esc((err as Error).message)}</p>`;
    }
  });

  // ── agent: measurements + find ────────────────────────────────────────────
  for (const btn of bar.querySelectorAll<HTMLButtonElement>(".measure")) {
    btn.addEventListener("click", () => {
      const input = q<HTMLInputElement>(`input[data-dim="${btn.dataset.dim}"]`);
      btn.textContent = "click two points…"; btn.disabled = true;
      o.measure((m) => { input.value = String(Math.round(m / INCH_M)); btn.textContent = "measure"; btn.disabled = false; });
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
      for (const h of json.picks) picks.appendChild(card(h));
    } catch (e) {
      status.className = "status err"; status.textContent = (e as Error).message;
    } finally { clearInterval(tick); find.disabled = false; }
  };
  find.addEventListener("click", run);
  q<HTMLTextAreaElement>(".ask").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); run(); } });
}
