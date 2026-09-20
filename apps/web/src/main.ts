import * as THREE from "three";
import { ACESFilmicToneMapping, Scene, VSMShadowMap, Vector2, WebGLRenderer } from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { ModelAsset, Product, RoomSpec } from "@contracts";
import { RoomShell } from "./room/buildRoom";
import { DEFAULT_SUN, lookAt, type SunSettings } from "./room/sun";
import { DEFAULT_FLOOR, DEFAULT_PAINT } from "./room/floors";
import type { OutsideView } from "./room/outside";
import { animateTo, createCamera, presetView, type ViewPreset } from "./interactions/camera";
import { INCH_M } from "./interactions/units";
import { WallPicker } from "./interactions/wallPicker";
import { copyText, decodePlan, encodePlan, planFromState, planUrl, roomFromPlan, sunFromPlan, windowsFromPlan, type Plan } from "./interactions/share";
import { doorArc, type WindowSpec } from "./interactions/wallGrid";
import { LampRegistry } from "./interactions/lamps";
import { PlacementController } from "./interactions/placement";
import { MeasureTool } from "./interactions/measure";
import { Catalog } from "./catalog/catalog";
import QRCode from "qrcode";
import { mountSidebar } from "./catalog/sidebar";
import { ThumbnailRenderer } from "./catalog/thumbnails";
import { mountDetail } from "./catalog/detail";
import { mountImporter } from "./catalog/importer";
import { createDesignStore, loadBuiltinDesigns } from "./interactions/designs";
import { mountDesignsBar } from "./catalog/designsBar";
import { mountShopBar } from "./catalog/shopBar";
import { mountSharePopup } from "./catalog/sharePopup";
import { saveGeneratedEntry } from "./catalog/generatedCatalog";
import { mountBudgetBar } from "./commerce/budgetBar";
import { saveProduct } from "./commerce/savedProducts";
import { createPaymentsClient, type PaymentIntent } from "./commerce/payments";
import { mountCheckout } from "./commerce/checkout";
import "./commerce/commerce.css";

const INTENT_KEY = "dreamgrid.paymentIntent";
function readSavedIntent(): PaymentIntent | undefined {
  try { const raw = localStorage.getItem(INTENT_KEY); return raw ? (JSON.parse(raw) as PaymentIntent) : undefined; } catch { return undefined; }
}

const overlay = document.getElementById("dims") as HTMLDivElement;
const form = document.getElementById("dims-form") as HTMLFormElement;

function roomFromInches(w: number, d: number, h: number): RoomSpec | null {
  if (![w, d, h].every((v) => Number.isFinite(v) && v > 0)) return null;
  return { widthM: w * INCH_M, depthM: d * INCH_M, heightM: h * INCH_M, gridSizeM: INCH_M, lightingMode: "day" };
}

function build(room: RoomSpec, plan: Plan | null = null, view = false) {
  overlay.hidden = true;
  stopPolling();
  void start(room, plan, view).catch((error) => {
    console.error("Room initialization failed", error);
    const hint = document.getElementById("hint")!;
    hint.hidden = false;
    hint.textContent = "The room could not load. Please refresh to try again.";
  });
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const f = new FormData(form);
  const num = (k: string) => Number(f.get(k) ?? 0);
  const room = roomFromInches(num("w-ft") * 12 + num("w-in"), num("d-ft") * 12 + num("d-in"), num("h-ft") * 12 + num("h-in"));
  if (room) build(room);
});

// "Measure with my phone": ask the dev server for its LAN address and show the short link.
document.getElementById("phone-link")!.addEventListener("click", async () => {
  const out = document.getElementById("phone-out")!;
  out.hidden = false;
  out.innerHTML = `<p class="note">Looking up this Mac's address…</p>`;
  try {
    const { url, https } = (await (await fetch("/api/phone-link", { cache: "no-store" })).json()) as { url: string; https: boolean };
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
    out.innerHTML = `<div class="phone-card">
      <div class="qr"><canvas id="qr"></canvas></div>
      <div class="phone-body">
        <h3>Scan with your phone</h3>
        <ol><li>Same Wi-Fi as this Mac</li><li>Open the link, allow the camera${https ? ", accept the certificate" : ""}</li><li>Measure — the room appears here</li></ol>
      </div>
      <div class="phone-url"><code>${esc(url)}</code><button type="button" class="copy">Copy</button></div>
      ${https ? "" : `<p class="phone-warn">Safari needs https for the camera. Restart with <b>npm run dev</b> (https is the default).</p>`}
    </div>`;
    out.querySelector(".copy")!.addEventListener("click", async (e) => {
      const b = e.currentTarget as HTMLButtonElement;
      try { await navigator.clipboard.writeText(url); b.textContent = "Copied"; } catch { b.textContent = "Select it"; }
      setTimeout(() => (b.textContent = "Copy"), 1600);
    });
    await QRCode.toCanvas(document.getElementById("qr") as HTMLCanvasElement, url, { width: 128, margin: 0, color: { dark: "#3f3a2e", light: "#ffffff" } });
  } catch {
    out.innerHTML = `<p class="note">Couldn't reach the dev server.</p>`;
  }
});

// While the form is open, watch for a measurement sent from the phone app.
let pollTimer = 0;
const pageLoadedAt = Date.now();
async function poll() {
  try {
    const r = await fetch(`/api/measurement?since=${pageLoadedAt}`, { cache: "no-store" });
    if (r.status === 200) {
      const m = (await r.json()) as { w: number; d: number; h: number };
      const room = roomFromInches(m.w, m.d, m.h);
      if (room) return build(room);
    }
  } catch { /* dev server not reachable; keep trying */ }
  pollTimer = window.setTimeout(poll, 1500);
}
function stopPolling() { clearTimeout(pollTimer); pollTimer = -1; }

// A shared plan (?plan=) or raw dimensions (?w=&d=&h= in inches) build the room immediately.
{
  const q = new URLSearchParams(location.search);
  const plan = q.get("plan") ? decodePlan(q.get("plan")!) : null;
  if (plan) build(roomFromPlan(plan), plan, q.get("view") === "1");
  else {
    const room = roomFromInches(Number(q.get("w")), Number(q.get("d")), Number(q.get("h")));
    if (room) build(room);
  }
}
if (!overlay.hidden) poll();

async function start(room: RoomSpec, plan: Plan | null, view: boolean) {
  const canvas = document.createElement("canvas");
  document.getElementById("stage")!.appendChild(canvas);
  document.body.classList.toggle("has-sidebar", !view);

  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0); // page CSS paints the background; keeps it out of tone mapping
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = VSMShadowMap;
  renderer.toneMapping = ACESFilmicToneMapping;

  const scene = new Scene();
  const shell = new RoomShell(room);
  const windows: WindowSpec[] = plan ? windowsFromPlan(plan) : [];
  shell.setWindows(windows);
  if (plan?.paint) shell.setWallColor(`#${plan.paint}`);
  if (plan?.floor) shell.setFloor(plan.floor);
  if (plan?.vw) shell.view = plan.vw as OutsideView;
  scene.add(shell.group);

  const layout = () => {
    const stage = document.getElementById("stage")!;
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false);
    canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
    return [w, h] as const;
  };
  layout();
  const { camera, controls } = createCamera(room, canvas);
  const frameHooks: Array<() => void> = [];

  // Gentle bloom so the window panes and sunlit floor glow like a diorama render.
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new Vector2(window.innerWidth, window.innerHeight), 0.16, 0.5, 0.9);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const onResize = () => {
    const [w, h] = layout();
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    composer.setSize(w, h);
    composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  };
  window.addEventListener("resize", onResize);
  new ResizeObserver(onResize).observe(document.getElementById("stage")!);

  // View snaps (subtle text links, bottom-right of the stage).
  let viewAnim: (() => boolean) | null = null;
  const viewsEl = document.getElementById("views")!;
  viewsEl.hidden = false;
  viewsEl.querySelectorAll<HTMLButtonElement>("button").forEach((b) => b.addEventListener("click", () => {
    viewAnim = animateTo(camera, controls, presetView(room, b.dataset.view as ViewPreset));
    viewsEl.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
  }));
  controls.addEventListener("start", () => { viewAnim = null; viewsEl.querySelectorAll("button").forEach((x) => x.classList.remove("on")); });
  frameHooks.push(() => { if (viewAnim && viewAnim()) viewAnim = null; });

  // ---- chrome ------------------------------------------------------------
  document.getElementById("chrome")!.hidden = false;
  document.getElementById("dims-chip")!.textContent = `${ftIn(room.widthM)} × ${ftIn(room.depthM)} × ${ftIn(room.heightM)}`;
  const hint = document.getElementById("hint")!;
  const share = document.getElementById("share")!;
  document.getElementById("home")!.addEventListener("click", () => { location.href = location.pathname; });
  const shared = document.getElementById("shared")!;
  const sidebar = document.getElementById("sidebar")!;

  const lamps = new LampRegistry();
  const catalog = await Catalog.load();
  let picker: WallPicker | null = null;
  let placement: PlacementController | null = null;
  let budgetUsd = plan?.b ?? 0;
  let refreshBudget = () => {};

  // Keep the address bar in sync so the current URL is always the current plan.
  let sun: SunSettings = plan ? sunFromPlan(plan) : { ...DEFAULT_SUN };
  const currentPlan = (): Plan =>
    planFromState(room, picker?.windows ?? windows, placement?.items ?? plan?.items ?? [], {
      paint: shell.paint !== DEFAULT_PAINT ? shell.paint : undefined,
      floor: shell.floor !== DEFAULT_FLOOR ? shell.floor : undefined,
      sun,
      view: shell.view,
      budgetUsd,
      openItems: placement?.openItemIds ?? plan?.openItems,
      ignored: placement?.ignoredIds ?? plan?.ign,
    });
  const designs = createDesignStore(undefined, await loadBuiltinDesigns());
  let designId: string | null = new URLSearchParams(location.search).get("design");
  let designName = designId ? designs.get(designId)?.name ?? "" : "";
  let refreshShopList: () => void = () => {};
  const syncUrl = () => {
    const u = new URL(planUrl(currentPlan(), view));
    if (designId) u.searchParams.set("design", designId);
    history.replaceState(null, "", u.toString());
    refreshShopList();
    refreshBudget();
  };
  const listUrl = () => `${new URL("/list.html", location.href)}?plan=${encodePlan(currentPlan())}`;
  const shoppingRows = () => {
    const counts = new Map<string, number>();
    for (const it of currentPlan().items) counts.set(it.productId, (counts.get(it.productId) ?? 0) + 1);
    return [...counts].flatMap(([id, qty]) => { const e = catalog.get(id); return e ? [{ product: e.product, qty }] : []; });
  };

  const applySun = (s: SunSettings) => {
    sun = s;
    shell.setSun(s);
    const look = lookAt(s.t);
    lamps.setMode(look.lampsOn ? "night" : "day");
    bloom.strength = look.bloom;
    bloom.threshold = look.bloomThreshold;
    bloom.radius = look.bloomRadius;
    renderer.toneMappingExposure = look.exposure;
    // The page behind the room follows the hour: warm at sunrise/sunset, deep green-blue at midnight.
    document.documentElement.style.setProperty("--page", look.page);
    document.body.classList.toggle("night", look.lampsOn && s.t > 0.8);
    syncUrl();
  };

  if (view) {
    // Read-only: no wall picking, no sidebar, no dragging. Offer an editable copy instead.
    hint.hidden = true;
    share.hidden = true;
    sidebar.hidden = true;
    shared.hidden = false;
    shared.addEventListener("click", () => (location.href = planUrl(currentPlan(), false)));
    onResize();
    if (plan?.items.length) {
      const viewer = new PlacementController(scene, camera, canvas, room, controls, catalog, lamps, () => {});
      await viewer.loadItems(plan.items, plan.openItems, plan.ign);
    }
  } else {
    sidebar.hidden = false;
    document.getElementById("leftbar")!.hidden = false;
    document.body.classList.add("has-leftbar");
    onResize();
    const tools = document.getElementById("item-tools")!;
    const stateBtn = document.getElementById("tool-state") as HTMLButtonElement;
    const upBtn = document.getElementById("tool-up") as HTMLButtonElement, downBtn = document.getElementById("tool-down") as HTMLButtonElement;
    const ignoreBtn = document.getElementById("tool-ignore") as HTMLButtonElement;
    ignoreBtn.addEventListener("click", () => placement!.toggleIgnoreSelected());
    placement = new PlacementController(scene, camera, canvas, room, controls, catalog, lamps, () => syncUrl(), (on) => shell.setGridVisible(on), (item) => {
      tools.hidden = !item;
      const state = item ? placement!.stateFor(item.id) : undefined;
      stateBtn.hidden = !state;
      stateBtn.textContent = state?.isOpen ? "Close fridge" : "Open fridge";
      stateBtn.setAttribute("aria-pressed", String(state?.isOpen ?? false));
      stateBtn.title = "Preview the door and interior; placement clearance uses the closed cabinet";
      if (!item) { ignoreBtn.hidden = true; return; }
      const flagged = placement!.isFlagged(item.id), ignoring = placement!.isIgnored(item.id);
      ignoreBtn.hidden = !(flagged || ignoring);
      ignoreBtn.textContent = ignoring ? "Show overlap" : "Ignore overlap";
      ignoreBtn.title = ignoring ? "Turn the red overlap warning back on for this item" : "Keep this item here without the red overlap warning";
      // Only decor and table lamps move vertically; everything else stays on the floor.
      const raisable = placement!.canRaise(item.id);
      upBtn.hidden = downBtn.hidden = !raisable;
      upBtn.disabled = downBtn.disabled = false;
      upBtn.title = downBtn.title = "Move up or down (↑ / ↓, shift for a foot)";
      document.getElementById("tool-rotate")!.title = placement!.isWallMounted(item.id) ? "Move to the other wall (R)" : "Rotate 90° (R)";
    });
    document.getElementById("tool-rotate")!.addEventListener("click", () => placement!.rotateSelected());
    document.getElementById("tool-delete")!.addEventListener("click", () => placement!.removeSelected());
    stateBtn.addEventListener("click", () => placement!.toggleSelectedState());
    upBtn.addEventListener("click", () => placement!.raiseSelected(1));
    downBtn.addEventListener("click", () => placement!.raiseSelected(-1));
    // keep the toolbar pinned above the selected item
    const anchorTools = () => {
      const a = placement?.selectedAnchor();
      if (!a || tools.hidden) return;
      const v = a.project(camera);
      const r = canvas.getBoundingClientRect();
      tools.style.left = `${r.left + ((v.x + 1) / 2) * r.width}px`;
      tools.style.top = `${r.top + ((1 - v.y) / 2) * r.height}px`;
    };
    frameHooks.push(anchorTools);
    const doorsOf = (ws: WindowSpec[]) => ws.filter((x) => x.kind === "door").map((x) => doorArc(x, room));
    picker = new WallPicker(scene, camera, canvas, room, shell, document.getElementById("menu")!, (ws) => { hint.hidden = true; placement!.setDoors(doorsOf(ws)); syncUrl(); });
    picker.windows.push(...windows); // windows restored from a shared plan stay editable
    placement.setDoors(doorsOf(windows));
    if (windows.length) hint.hidden = true;
    const thumbs = new ThumbnailRenderer();
    const detail = mountDetail(document.getElementById("detail")!, {
      thumbnail: (entry, size) => thumbs.render(entry, size),
      onAdd: (entry) => {
        if (!entry.asset && entry.product.styleTags.includes("model-pending")) importer.open(entry.product);
        else void placement!.add(entry.product, entry.asset, [0, 0, 0]).catch(e => { hint.hidden = false; hint.textContent = (e as Error).message; });
      },
    });
    const onImported = async (r: { product: Product; asset: ModelAsset }) => {
      // Await the actual GLB before reporting success. No placeholder for live imports.
      await placement!.add(r.product, r.asset, [0, 0, 0]);
      catalog.add([r.product], [r.asset]);
      saveProduct(r.product);
      try { saveGeneratedEntry(r); }
      catch { hint.hidden = false; hint.textContent = "Model added, but browser storage is full. It may not survive a reload."; }
    };
    const importer = mountImporter(document.getElementById("import-popup")!, onImported);
    mountSidebar(sidebar, {
      catalog,
      drag: { start: (entry, e) => {
        if (!entry.asset && entry.product.styleTags.includes("model-pending")) { importer.open(entry.product); return null; }
        return placement!.beginCatalogDrag(entry, e);
      } },
      thumbnail: (entry, size) => thumbs.render(entry, size),
      onOpen: (entry) => detail.open(entry),
      onImport: () => importer.open(),
      paint: shell.paint,
      floor: shell.floor,
      sun,
      onPaint: (hex) => { shell.setWallColor(hex); syncUrl(); },
      onFloor: (key) => { shell.setFloor(key); syncUrl(); },
      onSun: applySun,
      view: shell.view,
      onView: (v) => { shell.setView(v); syncUrl(); },
      onHighlightWall: (w) => shell.setWallHighlight(w),
    });
    const bar = mountDesignsBar(document.getElementById("leftbar")!, document.getElementById("save-popup")!, {
      store: designs,
      room,
      currentId: designId,
      currentName: designName,
      currentPlan,
      thumbnail: () => {
        try {
          composer.render(); // make sure the drawing buffer holds the current frame
          const c = document.createElement("canvas");
          c.width = 192; c.height = Math.round((192 * canvas.height) / canvas.width);
          c.getContext("2d")!.drawImage(canvas, 0, 0, c.width, c.height);
          return c.toDataURL("image/jpeg", 0.7);
        } catch { return undefined; }
      },
      onOpen: (d) => { location.href = `${planUrl(d.plan, false)}&design=${encodeURIComponent(d.id)}`; },
      onSaved: (d) => { designId = d.id; designName = d.name; syncUrl(); },
      onNewRoom: ({ w, d, h }) => { location.href = `${location.pathname}?w=${w}&d=${d}&h=${h}`; },
    });
    void bar;
    // Measure: two clicks anywhere in the room → distance.
    const measureBtn = document.getElementById("measure")!;
    const measureLabel = document.getElementById("measure-label")!;
    measureBtn.hidden = false;
    const measure = new MeasureTool(scene, camera, canvas, room, () => placement!.objects(), measureLabel, (on) => {
      measureBtn.querySelector(".lbl")!.textContent = on ? "Click two points · Esc to stop" : "Measure";
      measureBtn.classList.toggle("on", on);
      hint.hidden = true;
    });
    measureBtn.addEventListener("click", () => measure.toggle());
    frameHooks.push(() => {
      const a = measure.labelAnchor();
      if (!a) return;
      const v = a.point.clone().project(camera);
      const r = canvas.getBoundingClientRect();
      measureLabel.style.left = `${r.left + ((v.x + 1) / 2) * r.width}px`;
      measureLabel.style.top = `${r.top + ((1 - v.y) / 2) * r.height - 14}px`;
    });

    // Right drawer: furniture browser + shopping agent.
    const shopBar = mountShopBar(document.getElementById("rightbar")!, {
      rows: shoppingRows,
      listUrl,
      addFromUrl: (url) => importer.open(url),
      addFurniture: (seed) => {
        // A listing generated earlier is already in the catalog: open its card instead of paying again.
        const existing = [...catalog.allProducts()].find((p) => p.sourceUrl && p.sourceUrl === seed.sourceUrl);
        const entry = existing && catalog.get(existing.id);
        if (entry?.asset?.status === "ready") { detail.open(entry); return; }
        shopBar.setOpen(false);
        importer.open(seed);
      },
      measure: (cb) => measure.measureOnce(cb),
      remainingBudgetUsd: () => budgetUsd > 0 ? budget.summary.remainingUsd : undefined,
      onOpen: () => budget.setOpen(false),
    });
    const checkout = mountCheckout(document.getElementById("checkout-popup")!, { payments: createPaymentsClient(), copyText });
    const budget = mountBudgetBar(document.getElementById("budgetbar")!, document.getElementById("budget") as HTMLButtonElement, {
      room, catalog, items: () => placement!.items, budgetUsd,
      onBudgetChange: (usd) => { budgetUsd = usd; syncUrl(); },
      swap: (id, product) => placement!.replace(id, product, catalog.get(product.id)?.asset),
      copyText,
      checkout,
      onOpen: () => shopBar.setOpen(false),
      // The sandbox receipt for this room survives a reload (the API keeps the ledger while it runs).
      savedIntent: readSavedIntent(),
      onIntentChange: (intent) => { try { intent ? localStorage.setItem(INTENT_KEY, JSON.stringify(intent)) : localStorage.removeItem(INTENT_KEY); } catch { /* storage full or blocked */ } },
    });
    refreshBudget = () => budget.refresh();
    refreshShopList = () => shopBar.refresh();
    catalog.onChange(() => { refreshBudget(); refreshShopList(); });

    // Reset: back to an empty room with the same measurements (two clicks, no dialog).
    const reset = document.getElementById("reset-design")!;
    reset.hidden = false;
    let armed = 0;
    reset.addEventListener("click", () => {
      if (!armed) {
        reset.querySelector(".lbl")!.textContent = "Reset? Click again";
        reset.classList.add("armed");
        armed = window.setTimeout(() => { armed = 0; reset.querySelector(".lbl")!.textContent = "Reset"; reset.classList.remove("armed"); }, 3500);
        return;
      }
      const inches = (m: number) => Math.round(m / INCH_M);
      location.href = `${location.pathname}?w=${inches(room.widthM)}&d=${inches(room.depthM)}&h=${inches(room.heightM)}`;
    });
    const sharePopup = mountSharePopup(document.getElementById("share-popup")!, {
      link: () => planUrl(currentPlan(), true),
      listUrl,
      rows: shoppingRows,
    });
    share.addEventListener("click", () => void sharePopup.open());
    if (plan?.items.length) await placement.loadItems(plan.items, plan.openItems, plan.ign);
  }

  applySun(sun);
  if (import.meta.env.DEV) (window as unknown as { __dg: unknown }).__dg = { scene, shell, placement, THREE, renderer, GLTFLoader };

  let last = performance.now();
  renderer.setAnimationLoop((now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    controls.update();
    shell.update(dt, now / 1000, renderer);
    for (const f of frameHooks) f();
    composer.render();
  });
}

function ftIn(m: number): string {
  const inches = Math.round(m / INCH_M);
  const ft = Math.floor(inches / 12), rem = inches % 12;
  return rem ? `${ft}' ${rem}"` : `${ft}'`;
}
