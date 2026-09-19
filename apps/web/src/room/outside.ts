// What you see through a window: a small diorama box behind the wall with sky, ground, a leafy
// tree built from hundreds of leaf sprites (they cast dappled light into the room), and weather.
import {
  BackSide, CanvasTexture, Color, CylinderGeometry, DirectionalLight, DoubleSide, Euler, Group, HemisphereLight,
  InstancedMesh, LinearSRGBColorSpace, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry,
  Quaternion, Scene, SphereGeometry, SRGBColorSpace, Vector3, WebGLRenderTarget, WebGLRenderer,
} from "three";
import type { Look } from "./sun";

export type OutsideView = "leafy" | "autumn" | "snowy" | "rainy";
export const VIEWS: Array<{ key: OutsideView; label: string }> = [
  { key: "leafy", label: "Leafy" }, { key: "autumn", label: "Autumn" }, { key: "snowy", label: "Snowy" }, { key: "rainy", label: "Rainy" },
];
export const DEFAULT_VIEW: OutsideView = "leafy";

type Palette = { leaves: string[]; trunk: string; ground: string; skyTint: [string, number]; sunScale: number; hemiScale: number; cool: number };
const PALETTES: Record<OutsideView, Palette> = {
  leafy: { leaves: ["#5f9a3f", "#78b04a", "#a5d46a", "#4f8a36", "#8fc65a", "#c8e88a"], trunk: "#6b4a2f", ground: "#7fae52", skyTint: ["#ffffff", 0], sunScale: 1, hemiScale: 1, cool: 0 },
  autumn: { leaves: ["#d9772e", "#e8a53a", "#b8452c", "#f0c76a", "#c95d25", "#f2d98a"], trunk: "#5e3f28", ground: "#c98a4a", skyTint: ["#ffd9a8", 0.25], sunScale: 1.05, hemiScale: 0.95, cool: 0 },
  snowy: { leaves: ["#f4f8ff", "#e6eefb", "#dfe9f3", "#c9d9ea", "#ffffff", "#b9cfe4"], trunk: "#4a3a30", ground: "#f1f5fb", skyTint: ["#dfe9f3", 0.55], sunScale: 0.8, hemiScale: 1.15, cool: 0.35 },
  rainy: { leaves: ["#3f6b34", "#4e7d3f", "#5f8f4b", "#365c2d", "#6f9a5c", "#2f5028"], trunk: "#3f2e22", ground: "#4f6f3d", skyTint: ["#6f7f93", 0.65], sunScale: 0.25, hemiScale: 0.8, cool: 0.5 },
};

/** How a view changes the room's light: sun/hemisphere scale and how much to cool the colors. */
export function viewLighting(view: OutsideView): { sunScale: number; hemiScale: number; cool: number } {
  const p = PALETTES[view];
  return { sunScale: p.sunScale, hemiScale: p.hemiScale, cool: p.cool };
}

export type Outside = {
  /** What goes in the room scene: the pane showing the rendered view, plus an invisible leaf copy that casts shadows. */
  group: Group;
  update: (dt: number, time: number) => void;
  /** Render the hidden diorama into the pane's texture. */
  render: (renderer: WebGLRenderer) => void;
  dispose: () => void;
};

/**
 * Build the diorama in the window's local frame: x along the wall (0..w), y up (0..h), z into the
 * room; the outside is −z. `wallT` is the wall thickness (the box starts just behind it).
 */
export type OutsideLimits = { up: number; down: number; left: number; right: number };

/** Small seeded PRNG (mulberry32) so a window's leaves and clouds keep their layout across rebuilds. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildOutside(w: number, h: number, wallT: number, look: Look, view: OutsideView, pageBg = "#adbc9c", limits: OutsideLimits = { up: 1.2, down: 0.8, left: 0.6, right: 0.6 }, seed = 1): Outside {
  void pageBg; void limits; // the diorama is never drawn in the room scene, so it may be any size
  const p = PALETTES[view];
  const rnd = seededRandom(seed); // same seed → same leaves and clouds at every time of day
  // The simulation lives in its own scene; only its rendered image reaches the room.
  const sim = new Scene();
  const depth = 3.2, drop = Math.max(1.0, h * 0.8), top = h + Math.max(1.6, h);
  const left = Math.max(1.0, w * 0.7), right = Math.max(1.0, w * 0.7);
  const bw = w + left + right, bh = top + drop, bd = depth;
  const cx = (w + right - left) / 2, cy = (top - drop) / 2, cz = -wallT - bd / 2;

  // Seamless sky dome (no box edges): gradient from zenith to a bright horizon, all the way down.
  const sky = skyTexture(look.pane, p.skyTint);
  const dome = new Mesh(new SphereGeometry(9, 48, 24), new MeshBasicMaterial({ map: sky, side: BackSide }));
  dome.position.set(cx, h / 2, cz);
  sim.add(dome);

  // Lights for the diorama (its own, so it reads well regardless of the room's shadows).
  sim.add(new HemisphereLight(new Color(look.sky), new Color(look.ground), 1.5));
  const key = new DirectionalLight(new Color(look.sun), Math.max(0.8, Math.min(2.6, look.sunIntensity * 0.8)));
  key.position.set(1.5, 3, 1.5);
  sim.add(key);

  // A canopy hangs into the top third of the view; the rest is open sky. It is built from
  // overlapping clumps of different sizes and heights (plus a few dangling sprigs) so the
  // lower edge is lumpy and organic rather than a line.
  const inner = { min: new Vector3(cx - bw / 2 + 0.05, -drop + 0.02, cz - bd / 2 + 0.05), max: new Vector3(cx + bw / 2 - 0.05, top - 0.05, -wallT - 0.25) };
  const leafCount = Math.round(Math.min(1600, Math.max(450, w * h * 750)));
  const clumps: Array<{ c: Vector3; r: Vector3 }> = [];
  const spread = w * 1.3 + 0.6;
  for (let i = 0; i < 8; i++) {
    const rr = (0.28 + rnd() * 0.4) * (w * 0.45 + 0.35);
    clumps.push({ c: new Vector3(cx + (rnd() - 0.5) * spread, h * (0.86 + rnd() * 0.4), -wallT - 0.75 - rnd() * 0.7), r: new Vector3(rr * (1 + rnd() * 0.5), rr * (0.55 + rnd() * 0.4), rr * 0.8) });
  }
  for (let i = 0; i < 3; i++) { // sprigs that dip lower
    const rr = (0.12 + rnd() * 0.12) * (w * 0.45 + 0.35);
    clumps.push({ c: new Vector3(cx + (rnd() - 0.5) * spread * 0.9, h * (0.62 + rnd() * 0.18), -wallT - 0.7 - rnd() * 0.5), r: new Vector3(rr * 1.3, rr, rr) });
  }
  const canopy = leafClumps(leafCount, clumps, p, view, inner, rnd);
  sim.add(canopy);
  const bush = canopy; // (kept for the sway update below)
  const branch = new Mesh(new CylinderGeometry(0.02, 0.045, w * 1.2 + 0.8, 8), new MeshStandardMaterial({ color: new Color(p.trunk), roughness: 1 }));
  branch.position.set(cx + w * 0.2, h * 1.05, -wallT - 1.0);
  branch.rotation.z = Math.PI / 2 - 0.12;
  sim.add(branch);
  // Soft clouds drifting across the sky.
  const clouds = cloudField(view, bw, bd, cx, cz, h, rnd);
  sim.add(clouds.group);

  // Weather.
  const weather = view === "snowy" ? particles(260, 0.05, 0.05, "#ffffff", 0.9, rnd) : view === "rainy" ? particles(420, 0.01, 0.22, "#c9d9ea", 0.55, rnd) : view === "autumn" ? particles(40, 0.09, 0.09, "#e8a53a", 1, rnd) : null;
  if (weather) { weather.mesh.position.set(cx, cy, cz); sim.add(weather.mesh); }
  const bounds = new Vector3(bw, bh, bd);

  // Camera: just inside the room, looking out so the window opening exactly fills the frame.
  const eye = 0.9; // deeper inside the room → a tighter view through the opening
  const camera = new PerspectiveCamera((2 * Math.atan(h / 2 / eye) * 180) / Math.PI, w / h, 0.05, 20);
  camera.position.set(w / 2, h / 2, eye);
  camera.lookAt(w / 2, h / 2, -1);

  // Render target + the pane in the room scene that displays it.
  const px = Math.max(256, Math.min(1024, Math.round(w * 400)));
  const rt = new WebGLRenderTarget(px, Math.max(256, Math.round((px * h) / w)));
  rt.texture.colorSpace = LinearSRGBColorSpace;
  const group = new Group();
  const pane = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ map: rt.texture }));
  pane.position.set(w / 2, h / 2, -wallT + 0.005);
  group.add(pane);
  // Invisible copy of the canopy so the sun still throws dappled leaf shadows into the room.
  const proxy = new InstancedMesh(canopy.geometry, new MeshBasicMaterial({ map: leafTexture(), alphaTest: 0.5, side: DoubleSide, colorWrite: false, depthWrite: false }), canopy.count);
  proxy.instanceMatrix = canopy.instanceMatrix;
  proxy.castShadow = true;
  group.add(proxy);

  const update = (dt: number, time: number) => {
    canopy.rotation.z = Math.sin(time * 0.6) * 0.012;
    bush.rotation.z = Math.cos(time * 0.8) * 0.02;
    clouds.update(dt, bw);
    if (!weather) return;
    const { mesh, vel, seed, mat, pos } = weather;
    for (let i = 0; i < pos.length; i++) {
      const v = pos[i];
      if (view === "snowy") { v.y -= 0.35 * dt; v.x += Math.sin(time * 1.2 + seed[i]) * 0.15 * dt; }
      else if (view === "rainy") { v.y -= 6 * dt; v.x -= 0.6 * dt; }
      else { v.y -= 0.45 * dt; v.x += Math.sin(time * 1.5 + seed[i]) * 0.35 * dt; }
      if (v.y < -bounds.y / 2) { v.y = bounds.y / 2; v.x = (Math.random() - 0.5) * bounds.x; v.z = (Math.random() - 0.5) * bounds.z; }
      if (v.x < -bounds.x / 2) v.x += bounds.x; if (v.x > bounds.x / 2) v.x -= bounds.x;
      const rot = view === "autumn" ? new Quaternion().setFromAxisAngle(new Vector3(0.3, 1, 0.2).normalize(), time * 2 + seed[i]) : view === "rainy" ? new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.1) : new Quaternion();
      mat.compose(v, rot, vel);
      mesh.setMatrixAt(i, mat);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };
  const render = (renderer: WebGLRenderer) => {
    const prev = renderer.getRenderTarget();
    const shadows = renderer.shadowMap.enabled;
    renderer.shadowMap.enabled = false;
    renderer.setRenderTarget(rt);
    renderer.render(sim, camera);
    renderer.setRenderTarget(prev);
    renderer.shadowMap.enabled = shadows;
  };
  const dispose = () => { rt.dispose(); };
  return { group, update, render, dispose };
}

/** Leaves distributed across several ellipsoid clumps (count split by volume). */
function leafClumps(n: number, clumps: Array<{ c: Vector3; r: Vector3 }>, p: Palette, view: OutsideView, inner: { min: Vector3; max: Vector3 }, rnd: () => number): InstancedMesh {
  const vols = clumps.map((k) => k.r.x * k.r.y * k.r.z);
  const total = vols.reduce((a, b) => a + b, 0);
  const geo = new PlaneGeometry(0.2, 0.2);
  const mat = new MeshStandardMaterial({ map: leafTexture(), alphaTest: 0.5, side: DoubleSide, roughness: 1, color: new Color("#ffffff") });
  const mesh = new InstancedMesh(geo, mat, n);
  const m = new Matrix4(), q = new Quaternion(), s = new Vector3(), pos = new Vector3(), col = new Color();
  const palette = p.leaves.map((c) => new Color(c));
  let i = 0;
  clumps.forEach((k, ci) => {
    const count = ci === clumps.length - 1 ? n - i : Math.round((vols[ci] / total) * n);
    for (let j = 0; j < count && i < n; j++, i++) {
      let u: number, v: number, w: number;
      do { u = rnd() * 2 - 1; v = rnd() * 2 - 1; w = rnd() * 2 - 1; } while (u * u + v * v + w * w > 1);
      const r = Math.cbrt(rnd()) * 0.45 + 0.55;
      pos.set(k.c.x + u * k.r.x * r, k.c.y + v * k.r.y * r, k.c.z + w * k.r.z * r).clamp(inner.min, inner.max);
      q.setFromEuler(new Euler((rnd() - 0.5) * 1.6, rnd() * Math.PI, (rnd() - 0.5) * 1.6));
      const sc = 0.7 + rnd() * 0.8;
      s.set(sc, sc, sc);
      m.compose(pos, q, s);
      mesh.setMatrixAt(i, m);
      col.copy(palette[Math.floor(rnd() * palette.length)]);
      if (view !== "snowy") col.offsetHSL(0, 0, (v * 0.5 + 0.5) * 0.14 - 0.08 + (w > 0 ? 0.03 : -0.03));
      mesh.setColorAt(i, col);
    }
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

function leafCloud(n: number, center: Vector3, radius: Vector3, p: Palette, view: OutsideView, inner: { min: Vector3; max: Vector3 }, floorY = -Infinity, rnd: () => number = Math.random): InstancedMesh {
  const geo = new PlaneGeometry(0.2, 0.2);
  const mat = new MeshStandardMaterial({ map: leafTexture(), alphaTest: 0.5, side: DoubleSide, roughness: 1, color: new Color("#ffffff") });
  const mesh = new InstancedMesh(geo, mat, n);
  const m = new Matrix4(), q = new Quaternion(), s = new Vector3(), pos = new Vector3(), col = new Color();
  const palette = p.leaves.map((c) => new Color(c));
  for (let i = 0; i < n; i++) {
    // Uniform-ish points in an ellipsoid, denser toward the outside so the silhouette reads.
    let u: number, v: number, w: number;
    do { u = rnd() * 2 - 1; v = rnd() * 2 - 1; w = rnd() * 2 - 1; } while (u * u + v * v + w * w > 1);
    const r = Math.cbrt(rnd()) * 0.4 + 0.6;
    pos.set(center.x + u * radius.x * r, center.y + v * radius.y * r, center.z + w * radius.z * r).clamp(inner.min, inner.max);
    // Organic lower edge: leaves thin out below `floorY` instead of stopping on a line.
    if (pos.y < floorY && rnd() < (floorY - pos.y) / 0.25) pos.y = floorY + rnd() * radius.y * 0.6;
    q.setFromEuler(new Euler((rnd() - 0.5) * 1.6, rnd() * Math.PI, (rnd() - 0.5) * 1.6));
    const k = 0.7 + rnd() * 0.8;
    s.set(k, k, k);
    m.compose(pos, q, s);
    mesh.setMatrixAt(i, m);
    col.copy(palette[Math.floor(rnd() * palette.length)]);
    // lighter toward the top for a sun-kissed canopy (not for snow, which is already white)
    if (view !== "snowy") col.offsetHSL(0, 0, (v * 0.5 + 0.5) * 0.14 - 0.08 + (w > 0 ? 0.03 : -0.03)); // lit on top and toward the room
    mesh.setColorAt(i, col);
  }
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

function particles(n: number, w: number, h: number, color: string, opacity: number, rnd: () => number = Math.random) {
  const geo = new PlaneGeometry(w, h);
  const material = new MeshBasicMaterial({ color: new Color(color), transparent: true, opacity, depthWrite: false, side: DoubleSide });
  const mesh = new InstancedMesh(geo, material, n);
  const pos: Vector3[] = [], seed: number[] = [];
  for (let i = 0; i < n; i++) { pos.push(new Vector3((rnd() - 0.5) * 4, (rnd() - 0.5) * 4, (rnd() - 0.5) * 2.4)); seed.push(rnd() * 6.28); }
  return { mesh, pos, seed, mat: new Matrix4(), vel: new Vector3(1, 1, 1) };
}

let leafTex: CanvasTexture | null = null;
function leafTexture(): CanvasTexture {
  if (leafTex) return leafTex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(32, 2); ctx.bezierCurveTo(60, 14, 60, 46, 32, 62); ctx.bezierCurveTo(4, 46, 4, 14, 32, 2); ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.18)"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(32, 6); ctx.lineTo(32, 58); ctx.stroke();
  leafTex = new CanvasTexture(c);
  leafTex.colorSpace = SRGBColorSpace;
  return leafTex;
}

function skyTexture([top, horizon, ground]: [string, string, string], tint: [string, number]): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 16; c.height = 256;
  const ctx = c.getContext("2d")!;
  const mix = (hex: string) => `#${new Color(hex).lerp(new Color(tint[0]), tint[1]).getHexString()}`;
  void ground;
  const gr = ctx.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, mix(top)); gr.addColorStop(0.42, mix(horizon)); gr.addColorStop(0.6, mix("#f4f1e6")); gr.addColorStop(1, mix(horizon));
  ctx.fillStyle = gr; ctx.fillRect(0, 0, 16, 256);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}


function cloudField(view: OutsideView, bw: number, bd: number, cx: number, cz: number, h: number, rnd: () => number = Math.random) {
  const group = new Group();
  const n = view === "rainy" ? 7 : 4;
  const tex = cloudTexture();
  const tint = view === "rainy" ? "#9aa6b6" : view === "snowy" ? "#f1f5fb" : "#ffffff";
  const items: Array<{ m: Mesh; speed: number }> = [];
  for (let i = 0; i < n; i++) {
    const s = 0.6 + rnd() * 0.9;
    const m = new Mesh(new PlaneGeometry(s * 1.8, s), new MeshBasicMaterial({ map: tex, color: new Color(tint), transparent: true, opacity: view === "rainy" ? 0.85 : 0.75, depthWrite: false, side: DoubleSide }));
    m.position.set(cx + (rnd() - 0.5) * bw, h * (0.35 + rnd() * 0.6), cz - bd * 0.3 + rnd() * 0.6);
    group.add(m);
    items.push({ m, speed: 0.02 + rnd() * 0.03 });
  }
  return {
    group,
    update: (dt: number, width: number) => {
      for (const { m, speed } of items) { m.position.x += speed * dt; if (m.position.x > cx + width / 2 + 1) m.position.x = cx - width / 2 - 1; }
    },
  };
}

let cloudTex: CanvasTexture | null = null;
function cloudTexture(): CanvasTexture {
  if (cloudTex) return cloudTex;
  const c = document.createElement("canvas");
  c.width = 256; c.height = 128;
  const ctx = c.getContext("2d")!;
  for (let k = 0; k < 9; k++) {
    const x = 40 + Math.random() * 176, y = 50 + Math.random() * 40, r = 25 + Math.random() * 30;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(255,255,255,0.9)"); g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  cloudTex = new CanvasTexture(c);
  cloudTex.colorSpace = SRGBColorSpace;
  return cloudTex;
}
