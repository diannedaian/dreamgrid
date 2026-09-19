// Shopping list page: everything placed in a shared plan, with real store links, prices and product photos.
import type { Product } from "@contracts";
import { Catalog } from "../catalog/catalog";
import { decodePlan, planUrl } from "../interactions/share";

const INCH_M = 0.0254;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const ftIn = (m: number) => { const i = Math.round(m / INCH_M); const ft = Math.floor(i / 12), r = i % 12; return r ? `${ft}' ${r}"` : `${ft}'`; };
const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const priceKnown = (p: Product) => p.priceUsd > 0 && !p.styleTags.includes("price-not-provided");
const SWATCH: Record<string, string> = { bed: "#e8c9c2", desk: "#d9b27e", chair: "#cfd8c4", shelf: "#b98a5e", lamp: "#f2d28b", decor: "#a9c2a0", misc: "#c9c3b8" };

async function main() {
  const root = document.getElementById("list")!;
  const plan = decodePlan(new URLSearchParams(location.search).get("plan") ?? "");
  if (!plan) { root.innerHTML = `<p class="empty">This link doesn't include a room. Open a DreamGrid room and use Share → Open shopping list.</p>`; return; }
  const catalog = await Catalog.load();

  const counts = new Map<string, number>();
  for (const it of plan.items) counts.set(it.productId, (counts.get(it.productId) ?? 0) + 1);
  const rows = [...counts].map(([id, qty]) => ({ entry: catalog.get(id), qty })).filter((r) => r.entry);

  document.getElementById("room")!.textContent = `${ftIn(plan.w * INCH_M)} × ${ftIn(plan.d * INCH_M)} room · ${plan.items.length} item${plan.items.length === 1 ? "" : "s"}`;
  (document.getElementById("open-room") as HTMLAnchorElement).href = planUrl(plan, true, new URL("/", location.href).toString());

  if (!rows.length) { root.innerHTML = `<p class="empty">Nothing placed in this room yet.</p>`; return; }
  let total = 0, unknown = 0;
  root.replaceChildren(...rows.map(({ entry, qty }) => {
    const p = entry!.product;
    const [w, h, d] = p.dimensionsM;
    const known = priceKnown(p);
    if (known) total += p.priceUsd * qty; else unknown += qty;
    const el = document.createElement("article");
    el.className = "row";
    el.innerHTML = `
      <div class="pic" style="background:${SWATCH[p.category] ?? SWATCH.misc}">${p.imageUrl ? `<img src="${esc(p.imageUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : `<span>${esc(p.category)}</span>`}</div>
      <div class="info">
        <div class="title">${esc(p.title)}</div>
        <div class="meta">${esc(p.merchant || "")}${p.merchant ? " · " : ""}${Math.round(w / INCH_M)}″ × ${Math.round(d / INCH_M)}″ × ${Math.round(h / INCH_M)}″ tall</div>
        <div class="buy">${p.sourceUrl ? `<a href="${esc(p.sourceUrl)}" target="_blank" rel="noopener">Buy at ${esc(p.merchant || new URL(p.sourceUrl).host.replace(/^www\./, ""))} ↗</a>` : `<span class="nolink">No store link</span>`}</div>
      </div>
      <div class="price">
        <div class="each">${known ? money(p.priceUsd) : "Price not listed"}</div>
        ${qty > 1 ? `<div class="qty">× ${qty}${known ? ` = ${money(p.priceUsd * qty)}` : ""}</div>` : ""}
      </div>`;
    el.querySelector("img")?.addEventListener("error", (e) => { const img = e.target as HTMLImageElement; img.replaceWith(Object.assign(document.createElement("span"), { textContent: p.category })); });
    return el;
  }));
  const tot = document.createElement("div");
  tot.className = "total";
  tot.innerHTML = `<span>Total</span><span>${money(total)}${unknown ? ` <small>+ ${unknown} item${unknown === 1 ? "" : "s"} without a listed price</small>` : ""}</span>`;
  root.appendChild(tot);
}
main();
