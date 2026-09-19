// Right-hand panel: catalog cards (drag into the room), wall paint, floor presets, sun.
import type { Catalog, CatalogEntry } from "./catalog";
import { FLOOR_PRESETS, PAINT_COLORS, floorSwatchDataUrl } from "../room/floors";
import { HEADINGS, TIMES, TIME_T, nearestTime, snapT, type SunSettings, type TimeOfDay } from "../room/sun";
import { VIEWS, type OutsideView } from "../room/outside";

export type DragHandlers = {
  /** Called on pointerdown on a card; returns handlers for the rest of the gesture. */
  start: (entry: CatalogEntry, e: PointerEvent) => { move: (e: PointerEvent) => void; end: (e: PointerEvent, cancelled: boolean) => void } | null;
};

export type SidebarOptions = {
  catalog: Catalog;
  drag: DragHandlers;
  /** Rendered preview for a card (PNG data URL), if available. */
  thumbnail: (entry: CatalogEntry, size: number) => Promise<string | null>;
  /** A plain click on a card opens its details. */
  onOpen: (entry: CatalogEntry) => void;
  /** "Add furniture" button: import a product from a link. */
  onImport: () => void;
  paint: string;
  floor: string;
  sun: SunSettings;
  onPaint: (hex: string) => void;
  onFloor: (key: string) => void;
  onSun: (sun: SunSettings) => void;
  view: OutsideView;
  onView: (view: OutsideView) => void;
  /** Hover feedback: which wall the compass refers to (null to clear). */
  onHighlightWall: (surface: "back-wall" | null) => void;
};

const SWATCH: Record<string, string> = { bed: "#e8c9c2", desk: "#d9b27e", chair: "#cfd8c4", shelf: "#b98a5e", lamp: "#f2d28b", decor: "#a9c2a0", misc: "#c9c3b8" };
const TIME_LABEL: Record<TimeOfDay, string> = { sunrise: "Sunrise", noon: "Noon", sunset: "Sunset", midnight: "Midnight" };

export function mountSidebar(root: HTMLElement, o: SidebarOptions): void {
  root.replaceChildren();
  const catalogEl = section(root, "Catalog", "catalog");
  const importBtn = document.createElement("button");
  importBtn.type = "button"; importBtn.className = "add-furniture"; importBtn.textContent = "+ Add furniture";
  importBtn.addEventListener("click", () => o.onImport());
  catalogEl.parentElement!.querySelector("h2")!.appendChild(importBtn);
  const renderCatalog = () => {
    catalogEl.replaceChildren();
    for (const group of o.catalog.grouped()) {
      const col = document.createElement("div");
      col.className = "group";
      const h = document.createElement("h3");
      h.textContent = group.label;
      col.appendChild(h);
      for (const entry of group.entries) col.appendChild(card(entry, o));
      catalogEl.appendChild(col);
    }
    if (!o.catalog.entries().length) catalogEl.innerHTML = `<p class="empty">No saved objects yet.</p>`;
  };
  renderCatalog();
  o.catalog.onChange(renderCatalog);

  // Paint
  const paintEl = section(root, "Paint", "paint");
  const swatches = document.createElement("div");
  swatches.className = "swatches";
  let paint = o.paint.toLowerCase();
  const paintButtons: HTMLButtonElement[] = [];
  const setPaint = (hex: string) => {
    paint = hex.toLowerCase();
    for (const b of paintButtons) b.classList.toggle("on", b.dataset.hex === paint);
    custom.value = paint;
    o.onPaint(paint);
  };
  for (const c of PAINT_COLORS) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "swatch-btn"; b.title = c.label; b.dataset.hex = c.key.toLowerCase();
    b.style.background = c.key;
    b.classList.toggle("on", c.key.toLowerCase() === paint);
    b.addEventListener("click", () => setPaint(c.key));
    paintButtons.push(b);
    swatches.appendChild(b);
  }
  const custom = document.createElement("input");
  custom.type = "color"; custom.value = paint; custom.title = "Custom color";
  custom.addEventListener("input", () => setPaint(custom.value));
  swatches.appendChild(custom);
  paintEl.appendChild(swatches);

  // Floor
  const floorEl = section(root, "Floor", "floor");
  const floors = document.createElement("div");
  floors.className = "floors";
  const floorButtons: HTMLButtonElement[] = [];
  for (const p of FLOOR_PRESETS) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "floor-btn"; b.title = `${p.group} · ${p.label}`;
    b.innerHTML = `<img src="${floorSwatchDataUrl(p)}" alt=""><span>${p.label}</span>`;
    b.classList.toggle("on", p.key === o.floor);
    b.addEventListener("click", () => { for (const x of floorButtons) x.classList.toggle("on", x === b); o.onFloor(p.key); });
    floorButtons.push(b);
    floors.appendChild(b);
  }
  floorEl.appendChild(floors);

  // Sun
  const sunEl = section(root, "Sun", "sun");
  const sun: SunSettings = { ...o.sun };
  // Time of day: a slider with four checkpoints; light blends between them.
  const times = document.createElement("div");
  times.className = "time";
  const slider = document.createElement("input");
  slider.type = "range"; slider.min = "0"; slider.max = "300"; slider.step = "1";
  slider.value = String(Math.round(sun.t * 300));
  slider.setAttribute("list", "sun-ticks");
  slider.addEventListener("wheel", (e) => e.preventDefault(), { passive: false }); // panel scroll must not change the time
  const ticks = document.createElement("datalist");
  ticks.id = "sun-ticks";
  for (const t of TIMES) { const o = document.createElement("option"); o.value = String(Math.round(TIME_T[t] * 300)); ticks.appendChild(o); }
  const labels = document.createElement("div");
  labels.className = "time-labels";
  const timeButtons = TIMES.map((t) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = TIME_LABEL[t];
    b.addEventListener("click", () => { sun.t = TIME_T[t]; slider.value = String(Math.round(sun.t * 300)); markTime(); o.onSun({ ...sun }); });
    labels.appendChild(b);
    return b;
  });
  const markTime = () => { const near = nearestTime(sun.t); for (let i = 0; i < TIMES.length; i++) timeButtons[i].classList.toggle("on", TIMES[i] === near && Math.abs(TIME_T[near] - sun.t) < 1e-6); };
  slider.addEventListener("input", () => {
    sun.t = snapT(Number(slider.value) / 300);
    slider.value = String(Math.round(sun.t * 300));
    markTime();
    o.onSun({ ...sun });
  });
  markTime();
  times.append(slider, ticks, labels);
  sunEl.appendChild(times);

  const compassRow = document.createElement("div");
  compassRow.className = "row";
  compassRow.innerHTML = `<span class="lbl">Which way does the <b>far wall</b> face?</span><span class="lbl sub">The far wall is the one straight ahead when the room loads. Hover here to see it highlighted.</span>`;
  const compass = document.createElement("div");
  compass.className = "compass";
  const headingButtons = HEADINGS.map((h, i) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = h; b.classList.toggle("on", i * 45 === sun.headingDeg);
    b.addEventListener("click", () => { sun.headingDeg = i * 45; for (const x of headingButtons) x.classList.toggle("on", x === b); o.onSun({ ...sun }); });
    compass.appendChild(b);
    return b;
  });
  compassRow.appendChild(compass);
  compassRow.addEventListener("pointerenter", () => o.onHighlightWall("back-wall"));
  compassRow.addEventListener("pointerleave", () => o.onHighlightWall(null));
  sunEl.appendChild(compassRow);

  const viewRow = document.createElement("div");
  viewRow.className = "row";
  viewRow.innerHTML = `<span class="lbl">Outside the windows</span>`;
  const views = document.createElement("div");
  views.className = "seg";
  const viewButtons = VIEWS.map((v) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = v.label; b.classList.toggle("on", v.key === o.view);
    b.addEventListener("click", () => { for (const x of viewButtons) x.classList.toggle("on", x === b); o.onView(v.key); });
    views.appendChild(b);
    return b;
  });
  viewRow.appendChild(views);
  sunEl.appendChild(viewRow);

  const hemi = document.createElement("div");
  hemi.className = "seg";
  const hemiButtons = (["Northern", "Southern"] as const).map((label, i) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = `${label} hemisphere`; b.classList.toggle("on", (i === 1) === sun.southern);
    b.addEventListener("click", () => { sun.southern = i === 1; for (const x of hemiButtons) x.classList.toggle("on", x === b); o.onSun({ ...sun }); });
    hemi.appendChild(b);
    return b;
  });
  sunEl.appendChild(hemi);
}

function section(root: HTMLElement, title: string, cls = ""): HTMLElement {
  const col = document.createElement("div");
  col.className = `col ${cls}`.trim();
  const h = document.createElement("h2");
  h.textContent = title;
  const body = document.createElement("div");
  body.className = "section";
  col.append(h, body);
  root.appendChild(col);
  return body;
}

function card(entry: CatalogEntry, o: SidebarOptions): HTMLElement {
  const { product, asset } = entry;
  const el = document.createElement("div");
  el.className = "item-card";
  const ready = !asset || asset.status === "ready";
  el.classList.toggle("pending", !ready);
  const [w, h, d] = product.dimensionsM.map((m) => Math.round(m / 0.0254));
  el.innerHTML = `
    <div class="swatch" style="background:${SWATCH[product.category] ?? SWATCH.misc}"><img alt="" hidden></div>
    <div class="meta">
      <div class="name">${escapeHtml(product.title)}</div>
      <div class="sub">${w}″ × ${d}″ × ${h}″ tall · $${product.priceUsd}</div>
      ${asset && asset.status !== "ready" ? `<div class="sub status">${asset.status}…</div>` : ""}
    </div>`;
  el.title = "Drag into the room · click for details";
  const img = el.querySelector("img")!;
  o.thumbnail(entry, 128).then((url) => { if (url) { img.src = url; img.hidden = false; } });

  // Drag to place; a click without movement opens the details.
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    const sx = e.clientX, sy = e.clientY;
    let g: ReturnType<DragHandlers["start"]> = null;
    const move = (ev: PointerEvent) => {
      if (!g) {
        if (!ready || Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
        g = o.drag.start(entry, ev);
        if (!g) return;
        el.classList.add("dragging");
      }
      g.move(ev);
    };
    const finish = (ev: PointerEvent, cancelled: boolean) => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", cancel);
      el.classList.remove("dragging");
      if (g) g.end(ev, cancelled);
      else if (!cancelled) o.onOpen(entry);
    };
    const up = (ev: PointerEvent) => finish(ev, false);
    const cancel = (ev: PointerEvent) => finish(ev, true);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", cancel);
  });
  return el;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
