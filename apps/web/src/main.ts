import * as THREE from "three";
import { ACESFilmicToneMapping, Scene, VSMShadowMap, Vector2, WebGLRenderer } from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { RoomSpec } from "@contracts";
import { RoomShell } from "./room/buildRoom";
import { DEFAULT_SUN, lookAt, type SunSettings } from "./room/sun";
import { DEFAULT_FLOOR, DEFAULT_PAINT } from "./room/floors";
import type { OutsideView } from "./room/outside";
import { createCamera } from "./interactions/camera";
import { INCH_M } from "./interactions/units";
import { WallPicker } from "./interactions/wallPicker";
import { copyText, decodePlan, planFromState, planUrl, roomFromPlan, sunFromPlan, windowsFromPlan, type Plan } from "./interactions/share";
import { doorArc, type WindowSpec } from "./interactions/wallGrid";
import { LampRegistry } from "./interactions/lamps";
import { PlacementController } from "./interactions/placement";
import { Catalog } from "./catalog/catalog";
import QRCode from "qrcode";
import { mountSidebar } from "./catalog/sidebar";
import { ThumbnailRenderer } from "./catalog/thumbnails";
import { mountDetail } from "./catalog/detail";
import { mountImporter } from "./catalog/importer";
import { createDesignStore } from "./interactions/designs";
import { mountDesignsBar } from "./catalog/designsBar";

const overlay = document.getElementById("dims") as HTMLDivElement;
const form = document.getElementById("dims-form") as HTMLFormElement;

function roomFromInches(w: number, d: number, h: number): RoomSpec | null {
  if (![w, d, h].every((v) => Number.isFinite(v) && v > 0)) return null;
  return { widthM: w * INCH_M, depthM: d * INCH_M, heightM: h * INCH_M, gridSizeM: INCH_M, lightingMode: "day" };
}

function build(room: RoomSpec, plan: Plan | null = null, view = false) {
  overlay.hidden = true;
  stopPolling();
  start(room, plan, view);
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
  out.textContent = "Looking up this Mac's address…";
  try {
    const { url, https } = (await (await fetch("/api/phone-link", { cache: "no-store" })).json()) as { url: string; https: boolean };
    out.innerHTML = https
      ? `Point your iPhone camera at this (same Wi-Fi), tap the link, accept the certificate warning, and leave this page open.<canvas id="qr"></canvas><code>${url}</code>The room appears here when you send it.`
      : `The server is on http, and Safari needs https for the camera. Restart with <b>npm run dev</b> (https is the default), then try again.<canvas id="qr"></canvas><code>${url}</code>`;
    await QRCode.toCanvas(document.getElementById("qr") as HTMLCanvasElement, url, { width: 220, margin: 1, color: { dark: "#3f3a2e", light: "#fbf5ea" } });
  } catch {
    out.textContent = "Couldn't reach the dev server.";
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

  // ---- chrome ------------------------------------------------------------
  document.getElementById("chrome")!.hidden = false;
  document.getElementById("dims-chip")!.textContent = `${ftIn(room.widthM)} × ${ftIn(room.depthM)} × ${ftIn(room.heightM)}`;
  const hint = document.getElementById("hint")!;
  const share = document.getElementById("share")!;
  const shared = document.getElementById("shared")!;
  const sidebar = document.getElementById("sidebar")!;

  const lamps = new LampRegistry();
  const catalog = await Catalog.load();
  const frameHooks: Array<() => void> = [];
  let picker: WallPicker | null = null;
  let placement: PlacementController | null = null;

  // Keep the address bar in sync so the current URL is always the current plan.
  let sun: SunSettings = plan ? sunFromPlan(plan) : { ...DEFAULT_SUN };
  const currentPlan = (): Plan =>
    planFromState(room, picker?.windows ?? windows, placement?.items ?? plan?.items ?? [], {
      paint: shell.paint !== DEFAULT_PAINT ? shell.paint : undefined,
      floor: shell.floor !== DEFAULT_FLOOR ? shell.floor : undefined,
      sun,
      view: shell.view,
    });
  const designs = createDesignStore();
  let designId: string | null = new URLSearchParams(location.search).get("design");
  let designName = designId ? designs.get(designId)?.name ?? "" : "";
  const syncUrl = () => {
    const u = new URL(planUrl(currentPlan(), view));
    if (designId) u.searchParams.set("design", designId);
    history.replaceState(null, "", u.toString());
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
      await viewer.loadItems(plan.items);
    }
  } else {
    sidebar.hidden = false;
    document.getElementById("leftbar")!.hidden = false;
    document.body.classList.add("has-leftbar");
    onResize();
    const tools = document.getElementById("item-tools")!;
    const upBtn = document.getElementById("tool-up") as HTMLButtonElement, downBtn = document.getElementById("tool-down") as HTMLButtonElement;
    placement = new PlacementController(scene, camera, canvas, room, controls, catalog, lamps, () => syncUrl(), (on) => shell.setGridVisible(on), (item) => {
      tools.hidden = !item;
      if (!item) return;
      const wall = placement!.isAgainstWall(item.id);
      upBtn.disabled = downBtn.disabled = !wall;
      upBtn.title = downBtn.title = wall ? "Move up or down the wall (↑ / ↓, shift for a foot)" : "Push the item against a wall to move it up or down";
    });
    document.getElementById("tool-rotate")!.addEventListener("click", () => placement!.rotateSelected());
    document.getElementById("tool-delete")!.addEventListener("click", () => placement!.removeSelected());
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
      onAdd: (entry) => placement!.add(entry.product, entry.asset, [0, 0, 0]),
    });
    const importer = mountImporter(document.getElementById("import-popup")!, (r) => {
      catalog.add([r.product], [r.asset]);
      const entry = catalog.get(r.product.id);
      if (entry) detail.open(entry);
    });
    mountSidebar(sidebar, {
      catalog,
      drag: { start: (entry, e) => placement!.beginCatalogDrag(entry, e) },
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
    // Reset: back to an empty room with the same measurements (two clicks, no dialog).
    const reset = document.getElementById("reset-design")!;
    reset.hidden = false;
    let armed = 0;
    reset.addEventListener("click", () => {
      if (!armed) {
        reset.textContent = "Really reset? Click again";
        reset.classList.add("armed");
        armed = window.setTimeout(() => { armed = 0; reset.textContent = "Reset"; reset.classList.remove("armed"); }, 3500);
        return;
      }
      const inches = (m: number) => Math.round(m / INCH_M);
      location.href = `${location.pathname}?w=${inches(room.widthM)}&d=${inches(room.depthM)}&h=${inches(room.heightM)}`;
    });
    share.addEventListener("click", async () => {
      const ok = await copyText(planUrl(currentPlan(), true));
      share.textContent = ok ? "Link copied" : "Copy failed";
      setTimeout(() => (share.textContent = "Share"), 1800);
    });
    if (plan?.items.length) await placement.loadItems(plan.items);
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
