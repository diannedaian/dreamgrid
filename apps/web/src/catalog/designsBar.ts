// Collapsible left drawer: saved designs. Save opens a popup to name the design, then offers the
// room-measurement inputs to start another one.
import type { RoomSpec } from "@contracts";
import type { DesignStore, SavedDesign } from "../interactions/designs";
import type { Plan } from "../interactions/share";

export type DesignsBarOptions = {
  store: DesignStore;
  room: RoomSpec;
  currentId: string | null;
  currentName: string;
  currentPlan: () => Plan;
  thumbnail: () => string | undefined;
  onOpen: (design: SavedDesign) => void;
  onSaved: (design: SavedDesign) => void;
  onNewRoom: (inches: { w: number; d: number; h: number }) => void;
};

const IN = 0.0254;
const ftIn = (m: number) => { const i = Math.round(m / IN); return `${Math.floor(i / 12)}'${i % 12 ? ` ${i % 12}"` : ""}`; };

export function mountDesignsBar(bar: HTMLElement, popup: HTMLElement, o: DesignsBarOptions) {
  let currentId = o.currentId;
  let currentName = o.currentName;
  const list = bar.querySelector<HTMLElement>(".designs")!;
  const toggle = document.getElementById("menu-toggle") as HTMLButtonElement;
  toggle.hidden = false;
  const saveBtn = document.getElementById("save-design") as HTMLButtonElement;
  saveBtn.hidden = false;

  const setOpen = (open: boolean) => { document.body.classList.toggle("leftbar-open", open); toggle.classList.toggle("open", open); toggle.title = open ? "Close layouts" : "Saved layouts"; try { localStorage.setItem("dreamgrid.leftbar", open ? "1" : "0"); } catch { /* ignore */ } };
  let open = false;
  try { open = localStorage.getItem("dreamgrid.leftbar") === "1"; } catch { /* ignore */ }
  setOpen(open);
  toggle.addEventListener("click", () => setOpen(!document.body.classList.contains("leftbar-open")));

  const render = () => {
    list.replaceChildren();
    const designs = o.store.list();
    if (!designs.length) { list.innerHTML = `<p class="empty">No saved layouts.</p>`; return; }
    for (const d of designs) {
      const el = document.createElement("div");
      el.className = "design" + (d.id === currentId ? " current" : "");
      el.innerHTML = `
        <div class="thumb">${d.thumb ? `<img src="${d.thumb}" alt="">` : ""}</div>
        <div class="meta"><div class="name">${esc(d.name)}</div><div class="sub">${ftIn(d.plan.w * IN)} × ${ftIn(d.plan.d * IN)} × ${ftIn(d.plan.h * IN)} · ${d.plan.items.length} item${d.plan.items.length === 1 ? "" : "s"}</div></div>
        <button type="button" class="del" title="Delete">✕</button>`;
      el.querySelector(".del")!.addEventListener("click", (e) => { e.stopPropagation(); o.store.remove(d.id); if (currentId === d.id) currentId = null; render(); });
      el.addEventListener("click", () => o.onOpen(d));
      list.appendChild(el);
    }
  };
  render();

  const openPopup = () => {
    popup.hidden = false;
    popup.innerHTML = `
      <div class="sheet" role="dialog" aria-label="Save layout">
        <button type="button" class="close" aria-label="Close">✕</button>
        <h2>Save this layout</h2>
        <label>Name <input type="text" class="name" maxlength="60" placeholder="e.g. Dorm, bed by the window" /></label>
        <div class="actions">
          <button type="button" class="primary do-save">${currentId ? "Save changes" : "Save"}</button>
          ${currentId ? `<button type="button" class="ghost do-copy">Save as a copy</button>` : ""}
        </div>
        <div class="after" hidden>
          <p class="ok">Saved.</p>
          <h3>Start another layout</h3>
          <p class="sub">Enter the room size for a fresh, empty room. Your saved layouts stay in the left bar.</p>
          <div class="dims">
            <label>Width <input class="w-ft" type="number" min="0" step="1" /> ft <input class="w-in" type="number" min="0" max="11" step="1" /> in</label>
            <label>Depth <input class="d-ft" type="number" min="0" step="1" /> ft <input class="d-in" type="number" min="0" max="11" step="1" /> in</label>
            <label>Height <input class="h-ft" type="number" min="0" step="1" /> ft <input class="h-in" type="number" min="0" max="11" step="1" /> in</label>
          </div>
          <div class="actions">
            <button type="button" class="primary do-new">New layout with these measurements</button>
            <button type="button" class="ghost do-stay">Keep editing this one</button>
          </div>
        </div>
      </div>`;
    const q = <T extends HTMLElement>(sel: string) => popup.querySelector<T>(sel)!;
    const name = q<HTMLInputElement>(".name");
    name.value = currentName;
    setTimeout(() => name.focus(), 0);
    const close = () => { popup.hidden = true; };
    q(".close").addEventListener("click", close);
    const fill = () => {
      const set = (cls: string, m: number) => { const i = Math.round(m / IN); q<HTMLInputElement>(`.${cls}-ft`).value = String(Math.floor(i / 12)); q<HTMLInputElement>(`.${cls}-in`).value = String(i % 12); };
      set("w", o.room.widthM); set("d", o.room.depthM); set("h", o.room.heightM);
    };
    const doSave = (asCopy: boolean) => {
      const saved = o.store.save({ id: asCopy ? undefined : currentId ?? undefined, name: name.value, plan: o.currentPlan(), thumb: o.thumbnail() });
      currentId = saved.id; currentName = saved.name;
      o.onSaved(saved);
      render();
      q(".after").hidden = false;
      q(".do-save").hidden = true; q<HTMLElement>(".do-copy")?.setAttribute("hidden", "");
      fill();
    };
    q(".do-save").addEventListener("click", () => doSave(false));
    popup.querySelector(".do-copy")?.addEventListener("click", () => doSave(true));
    name.addEventListener("keydown", (e) => { if (e.key === "Enter") doSave(false); });
    q(".do-stay").addEventListener("click", close);
    q(".do-new").addEventListener("click", () => {
      const n = (cls: string) => Number(q<HTMLInputElement>(`.${cls}`).value || 0);
      const w = n("w-ft") * 12 + n("w-in"), d = n("d-ft") * 12 + n("d-in"), h = n("h-ft") * 12 + n("h-in");
      if (w > 0 && d > 0 && h > 0) o.onNewRoom({ w, d, h });
    });
  };
  saveBtn.addEventListener("click", openPopup);
  popup.addEventListener("click", (e) => { if (e.target === popup) popup.hidden = true; });
  window.addEventListener("keydown", (e) => { if (e.key === "Escape" && !popup.hidden) popup.hidden = true; });

  return { render, setCurrent: (id: string | null, nm: string) => { currentId = id; currentName = nm; render(); } };
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
