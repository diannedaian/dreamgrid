// Shopping list rendering shared by the share popup and the right drawer.
import type { Product } from "@contracts";
import { priceKnown } from "../commerce/budget";

export type ShoppingRow = { product: Product; qty: number };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const INCH_M = 0.0254;
const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const SWATCH: Record<string, string> = { bed: "#e8c9c2", desk: "#d9b27e", chair: "#cfd8c4", shelf: "#b98a5e", lamp: "#f2d28b", decor: "#a9c2a0", misc: "#c9c3b8" };

export function listHtml(rows: ShoppingRow[]): string {
  if (!rows.length) return `<p class="sub">Nothing in the room yet.</p>`;
  let total = 0, unknown = 0;
  const items = rows.map(({ product: p, qty }) => {
    const known = priceKnown(p);
    if (known) total += p.priceUsd * qty; else unknown += qty;
    const [w, h, d] = p.dimensionsM.map((m) => Math.round(m / INCH_M));
    const store = p.merchant || (p.sourceUrl ? new URL(p.sourceUrl).host.replace(/^www\./, "") : "");
    return `<li class="li">
      <span class="pic" style="background:${SWATCH[p.category] ?? SWATCH.misc}">${p.imageUrl ? `<img src="${esc(p.imageUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : ""}</span>
      <span class="li-info">
        <span class="li-title">${esc(p.title)}${qty > 1 ? ` <small>× ${qty}</small>` : ""}</span>
        <span class="li-meta">${w}″ × ${d}″ × ${h}″${store ? ` · ${esc(store)}` : ""}</span>
        ${p.sourceUrl ? `<a href="${esc(p.sourceUrl)}" target="_blank" rel="noopener">Buy ↗</a>` : ""}
      </span>
      <span class="li-price">${known ? money(p.priceUsd * qty) : ""}</span>
    </li>`;
  }).join("");
  return `<ul class="shoplist">${items}</ul>
    <div class="total"><span>Total</span><span>${money(total)}${unknown ? ` <small>+ ${unknown} unpriced</small>` : ""}</span></div>`;
}


