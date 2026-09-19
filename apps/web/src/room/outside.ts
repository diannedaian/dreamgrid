// What you see through a window: a small diorama box behind the wall with sky, ground, a leafy
// tree built from hundreds of leaf sprites (they cast dappled light into the room), and weather.
import {
  BackSide, CanvasTexture, Color, DirectionalLight, DoubleSide, Euler, Group, HemisphereLight,
  InstancedMesh, LinearSRGBColorSpace, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry,
  Quaternion, Scene, ShaderMaterial, SphereGeometry, SRGBColorSpace, Texture, Vector2, Vector3, WebGLRenderTarget, WebGLRenderer,
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

  // An organic smattering of leaves: dense near the top of the view, thinning out lower down,
  // with loose clumps so it never reads as a line. No trunk or branches.
  const inner = { min: new Vector3(cx - bw / 2 + 0.05, -drop + 0.02, cz - bd / 2 + 0.05), max: new Vector3(cx + bw / 2 - 0.05, top - 0.05, -wallT - 0.25) };
  const leafCount = Math.round(Math.min(2200, Math.max(600, w * h * 1000)));
  const canopy = leafScatter(leafCount, { cx, w, h, wallT }, p, view, inner, rnd);
  sim.add(canopy);
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
  const pane = new Mesh(new PlaneGeometry(w, h), glassMaterial(rt.texture, rt.width, rt.height));
  pane.position.set(w / 2, h / 2, -wallT + 0.005);
  group.add(pane);
  // Invisible copy of the canopy so the sun still throws dappled leaf shadows into the room.
  const proxy = new InstancedMesh(canopy.geometry, new MeshBasicMaterial({ map: leafTexture(), alphaTest: 0.5, side: DoubleSide, colorWrite: false, depthWrite: false }), canopy.count);
  proxy.instanceMatrix = canopy.instanceMatrix;
  proxy.castShadow = true;
  group.add(proxy);

  const update = (dt: number, time: number) => {
    clouds.update(dt, bw); // leaves stay perfectly still
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

/**
 * Leaves scattered across the whole view with a smooth density field: densest at the very top,
 * thinning out downward, with gentle noise so the edge is ragged and organic (no clumps, no trunk).
 */
function leafScatter(n: number, f: { cx: number; w: number; h: number; wallT: number }, p: Palette, view: OutsideView, inner: { min: Vector3; max: Vector3 }, rnd: () => number): InstancedMesh {
  const geo = new PlaneGeometry(0.2, 0.2);
  const mat = new MeshStandardMaterial({ map: leafTexture(), alphaTest: 0.5, side: DoubleSide, roughness: 1, color: new Color("#ffffff") });
  const mesh = new InstancedMesh(geo, mat, n);
  const m = new Matrix4(), q = new Quaternion(), s = new Vector3(), pos = new Vector3(), col = new Color();
  const palette = p.leaves.map((c) => new Color(c));
  const spread = f.w * 2.2 + 1.5; // well past both edges so nothing "ends" inside the frame
  const yTop = f.h * 1.6, yBot = f.h * 0.3;
  // smooth noise from a few random sine waves
  const ph = Array.from({ length: 6 }, () => rnd() * 6.283);
  const noise = (x: number, y: number) =>
    0.5 + 0.5 * (Math.sin(x * 2.1 + ph[0]) * Math.sin(y * 3.3 + ph[1]) * 0.6 + Math.sin(x * 4.7 + ph[2] + y * 1.7) * 0.25 + Math.sin(x * 9.1 + ph[3]) * Math.sin(y * 7.3 + ph[4]) * 0.15);
  for (let i = 0; i < n; i++) {
    let x = 0, y = yTop, tries = 0;
    do {
      x = f.cx + (rnd() - 0.5) * spread;
      const t = rnd(); // 0 at the top, 1 at the bottom of the leaf zone
      y = yTop - t * (yTop - yBot);
      const density = Math.pow(1 - t, 2.2); // dense up top, sparse below
      if (rnd() < density * (0.35 + 0.65 * noise(x, y))) break;
    } while (++tries < 40);
    const z = -f.wallT - 0.4 - rnd() * 1.4;
    pos.set(x, y, z).clamp(inner.min, inner.max);
    q.setFromEuler(new Euler((rnd() - 0.5) * 1.6, rnd() * Math.PI, (rnd() - 0.5) * 1.6));
    const sc = 0.65 + rnd() * 0.85;
    s.set(sc, sc, sc);
    m.compose(pos, q, s);
    mesh.setMatrixAt(i, m);
    col.copy(palette[Math.floor(rnd() * palette.length)]);
    const t = (yTop - y) / (yTop - yBot);
    if (view !== "snowy") col.offsetHSL(0, 0, (1 - t) * 0.12 - 0.05 + (z > -f.wallT - 1 ? 0.03 : -0.03));
    mesh.setColorAt(i, col);
  }
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

/**
 * The pane: shows the rendered view through a subtle sheet of glass. Toward the left and right edges
 * the image softens and frosts a little, and a faint diagonal sheen sits over everything.
 */
function glassMaterial(map: Texture, width: number, height: number): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { map: { value: map }, texel: { value: new Vector2(1 / width, 1 / height) } },
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform sampler2D map;
      uniform vec2 texel;
      varying vec2 vUv;
      void main() {
        // A light, even sheet of glass: gentle blur and faint frost across the whole pane.
        float blur = 1.6; // blur radius in texels
        vec3 c = vec3(0.0);
        float wsum = 0.0;
        for (int i = -2; i <= 2; i++) for (int j = -2; j <= 2; j++) {
          vec2 o = vec2(float(i), float(j)) * texel * blur;
          float wgt = 1.0 / (1.0 + float(i * i + j * j) * 0.5);
          c += texture2D(map, vUv + o).rgb * wgt;
          wsum += wgt;
        }
        c /= wsum;
        float frost = 0.05;
        float sheen = smoothstep(0.35, 0.65, vUv.x * 0.6 + vUv.y * 0.4) * 0.04;
        c = mix(c, vec3(1.0), frost + sheen);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}
