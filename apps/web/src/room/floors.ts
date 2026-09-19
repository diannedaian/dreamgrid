// Floor presets. Each builds a tileable texture; `tileM` is the world size of one tile.
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from "three";

const IN = 0.0254;

export type FloorPreset = {
  key: string;
  label: string;
  group: "Wood" | "Tile" | "Carpet" | "Other";
  tileM: [w: number, d: number];
  roughness: number;
  /** Texture resolution for one tile (default 512). */
  px?: number;
  /** Grid-line ink that reads on this floor. */
  gridInk: "light" | "dark";
  paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
};

const wood = (tones: string[], seam: number, grain: number) => (ctx: CanvasRenderingContext2D, W: number, H: number) => {
  const planks = 6, ph = H / planks;
  for (let i = 0; i < planks; i++) {
    const y0 = i * ph;
    ctx.fillStyle = tones[i % tones.length];
    ctx.fillRect(0, y0, W, ph);
    for (let k = 0; k < 18; k++) {
      ctx.strokeStyle = `rgba(60, 35, 15, ${grain * (0.5 + Math.random())})`;
      ctx.lineWidth = 1 + Math.random() * 2;
      const y = y0 + Math.random() * ph;
      ctx.beginPath(); ctx.moveTo(0, y);
      ctx.bezierCurveTo(W * 0.3, y + (Math.random() - 0.5) * 8, W * 0.7, y + (Math.random() - 0.5) * 8, W, y);
      ctx.stroke();
    }
    ctx.fillStyle = `rgba(40, 25, 10, ${seam})`;
    ctx.fillRect(0, y0, W, 2);
    ctx.fillRect(((i * 0.37 + 0.15) % 1) * W, y0, 2, ph);
  }
};

const tile = (a: string, b: string, grout: string, n: number) => (ctx: CanvasRenderingContext2D, W: number, H: number) => {
  ctx.fillStyle = grout; ctx.fillRect(0, 0, W, H);
  const s = W / n, g = Math.max(2, W * 0.012);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    ctx.fillStyle = (i + j) % 2 ? b : a;
    ctx.fillRect(i * s + g / 2, j * s + g / 2, s - g, s - g);
  }
};

const noise = (base: string, spread: number, count: number) => (ctx: CanvasRenderingContext2D, W: number, H: number) => {
  ctx.fillStyle = base; ctx.fillRect(0, 0, W, H);
  for (let k = 0; k < count; k++) {
    const v = Math.random() * spread - spread / 2;
    ctx.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`;
    ctx.fillRect(Math.random() * W, Math.random() * H, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
};

/** Cut-pile carpet: soft mottling, thousands of tiny fibers, and a faint weave. */
const carpet = (base: string, fiber: [string, string]) => (ctx: CanvasRenderingContext2D, W: number, H: number) => {
  ctx.fillStyle = base; ctx.fillRect(0, 0, W, H);
  for (let k = 0; k < 24; k++) { // very soft mottling (kept faint so the tile repeat doesn't show)
    const x = Math.random() * W, y = Math.random() * H, r = W * (0.1 + Math.random() * 0.2);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const light = Math.random() > 0.5;
    g.addColorStop(0, light ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.lineCap = "round";
  for (let k = 0; k < 42000; k++) { // pile fibers
    const x = Math.random() * W, y = Math.random() * H, a = Math.random() * Math.PI * 2, len = 1.5 + Math.random() * 3;
    ctx.strokeStyle = Math.random() > 0.5 ? fiber[0] : fiber[1];
    ctx.globalAlpha = 0.18 + Math.random() * 0.25;
    ctx.lineWidth = 0.8 + Math.random() * 0.9;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); ctx.stroke();
  }
  ctx.globalAlpha = 0.06; // faint diagonal weave
  ctx.strokeStyle = "#000"; ctx.lineWidth = 1;
  for (let d = -H; d < W + H; d += 6) { ctx.beginPath(); ctx.moveTo(d, 0); ctx.lineTo(d + H, H); ctx.stroke(); }
  ctx.globalAlpha = 1;
};

export const FLOOR_PRESETS: FloorPreset[] = [
  { key: "wood-light", label: "Light wood", group: "Wood", tileM: [48 * IN, 30 * IN], roughness: 0.6, gridInk: "light", paint: wood(["#e0b77f", "#dcb279", "#e3bb84", "#d9ae75", "#dfb57d", "#dab077"], 0.18, 0.04) },
  { key: "wood-medium", label: "Medium wood", group: "Wood", tileM: [48 * IN, 30 * IN], roughness: 0.6, gridInk: "light", paint: wood(["#b9814c", "#b07845", "#bf8852", "#ad7443", "#b67e4a", "#b27a47"], 0.3, 0.06) },
  { key: "wood-dark", label: "Dark wood", group: "Wood", tileM: [48 * IN, 30 * IN], roughness: 0.55, gridInk: "light", paint: wood(["#6b4327", "#644023", "#71472a", "#5f3c21", "#6e4528", "#674125"], 0.45, 0.08) },
  { key: "tile-white", label: "White tile", group: "Tile", tileM: [24 * IN, 24 * IN], roughness: 0.35, gridInk: "dark", paint: tile("#f4f1ea", "#f4f1ea", "#cfc9bd", 2) },
  { key: "tile-checker", label: "Checker tile", group: "Tile", tileM: [24 * IN, 24 * IN], roughness: 0.35, gridInk: "light", paint: tile("#f2eee6", "#2e2b2a", "#bdb7ab", 2) },
  { key: "tile-terracotta", label: "Terracotta", group: "Tile", tileM: [24 * IN, 24 * IN], roughness: 0.8, gridInk: "light", paint: tile("#c47a52", "#bd7049", "#8f5638", 2) },
  { key: "carpet-beige", label: "Beige carpet", group: "Carpet", tileM: [40 * IN, 40 * IN], roughness: 1, px: 1024, gridInk: "dark", paint: carpet("#d6c7ad", ["#efe3cc", "#b9a888"]) },
  { key: "carpet-grey", label: "Grey carpet", group: "Carpet", tileM: [40 * IN, 40 * IN], roughness: 1, px: 1024, gridInk: "light", paint: carpet("#8d8d8a", ["#b3b3ae", "#6a6a67"]) },
  { key: "concrete", label: "Concrete", group: "Other", tileM: [36 * IN, 36 * IN], roughness: 0.9, gridInk: "light", paint: noise("#b9b6b0", 0.1, 3000) },
];

export const DEFAULT_FLOOR = "wood-light";

export function floorPreset(key: string | undefined): FloorPreset {
  return FLOOR_PRESETS.find((p) => p.key === key) ?? FLOOR_PRESETS.find((p) => p.key === DEFAULT_FLOOR)!;
}

export function makeFloorTexture(preset: FloorPreset, roomW: number, roomD: number, px = preset.px ?? 512): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = px; c.height = Math.round((px * preset.tileM[1]) / preset.tileM[0]);
  preset.paint(c.getContext("2d")!, c.width, c.height);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.anisotropy = 8;
  tex.repeat.set(roomW / preset.tileM[0], roomD / preset.tileM[1]);
  return tex;
}

/** Small preview for the sidebar. */
export function floorSwatchDataUrl(preset: FloorPreset, px = 64): string {
  const c = document.createElement("canvas");
  c.width = px; c.height = px;
  preset.paint(c.getContext("2d")!, px, px);
  return c.toDataURL();
}

/** Real paints you can buy. Hex values are the manufacturers' published RGB (PPG for Glidden). */
export const PAINT_COLORS: Array<{ key: string; label: string; brand: string; url: string }> = [
  { key: "#eee6db", label: "Pearls And Lace", brand: "Glidden Diamond · PPG1074-1", url: "https://www.homedepot.com/p/Glidden-Diamond-5-gal-PPG1074-1-Pearls-And-Lace-Ultra-Flat-Interior-Paint-with-Primer-PPG1074-1D-05UF/324948281" },
  { key: "#dacfba", label: "Toasted Almond", brand: "Glidden Diamond · PPG1097-3", url: "https://www.homedepot.com/p/Glidden-Diamond-5-gal-PPG1097-3-Toasted-Almond-Eggshell-Interior-Paint-with-Primer-PPG1097-3D-05E/309074183" },
  { key: "#a3bbcd", label: "Heavenly Blue", brand: "Glidden Diamond · PPG1159-3", url: "https://www.homedepot.com/p/Glidden-Diamond-5-gal-PPG1159-3-Heavenly-Blue-Semi-Gloss-Interior-Paint-with-Primer-PPG1159-3D-05SG/309532292" },
  { key: "#848585", label: "Dover Gray", brand: "Glidden Diamond · PPG1001-5", url: "https://www.homedepot.com/p/Glidden-Diamond-1-gal-PPG1001-5-Dover-Gray-Satin-Interior-Paint-with-Primer-PPG1001-5D-01SA/309703430" },
  // The Behr link is a brand page, not one color; Polar Bear 75 stands in as its warm white.
  { key: "#f2ede4", label: "Polar Bear 75", brand: "Behr Dynasty", url: "https://www.homedepot.com/b/Paint-Paint-Colors/BEHR-DYNASTY/N-5yc1vZcaw8Zsxl" },
];
export const DEFAULT_PAINT = "#eee6db";
