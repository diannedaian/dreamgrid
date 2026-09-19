// Shareable room plans: the whole plan is encoded in the URL (no server needed).
// Cindy owns this (interactions).
import type { RoomSpec, SceneItem } from "@contracts";
import { INCH_M } from "./units";
import type { WindowSpec } from "./wallGrid";
import { DEFAULT_SUN, TIME_T, type SunSettings, type TimeOfDay } from "../room/sun";

export type Plan = {
  v: 1;
  /** Room width, depth, height in whole inches. */
  w: number;
  d: number;
  h: number;
  /** Windows: surface (b = back wall, l = left wall) and u, v, width, height in whole inches. */
  win: Array<{ s: "b" | "l"; u: number; v: number; w: number; h: number; k?: "d"; f?: "a" | "s" | "o"; c?: 1 }>;
  /** Placed furniture (reserved for the catalog integration). */
  items: SceneItem[];
  /** IDs of models displaying their open pose; absent means all closed (legacy plans). */
  openItems?: string[];
  /** Sun: time of day as 0..300 (sunrise 0, noon 100, sunset 200, midnight 300), heading the far wall faces, southern hemisphere. Omitted when default. */
  t?: number;
  hd?: number;
  sh?: 1;
  /** Wall paint (hex without #) and floor preset key, when not the defaults. */
  paint?: string;
  floor?: string;
  /** Outside view when not leafy. */
  vw?: "autumn" | "snowy" | "rainy";
};

export type Look = { paint?: string; floor?: string; sun?: SunSettings; view?: string; openItems?: string[] };

const inches = (m: number) => Math.round(m / INCH_M);

export function planFromState(room: RoomSpec, windows: WindowSpec[], items: SceneItem[] = [], look: Look = {}): Plan {
  return {
    v: 1,
    w: inches(room.widthM),
    d: inches(room.depthM),
    h: inches(room.heightM),
    win: windows.map((x) => ({
      s: x.surface === "back-wall" ? "b" : "l", u: inches(x.uM), v: inches(x.vM), w: inches(x.widthM), h: inches(x.heightM),
      ...(x.kind === "door" ? { k: "d" as const } : {}),
      ...(x.shape === "arch" ? { f: "a" as const } : x.shape === "semi" ? { f: "s" as const } : x.shape === "oval" ? { f: "o" as const } : {}),
      ...(x.corner ? { c: 1 as const } : {}),
    })),
    items: items.map((i) => ({ ...i, positionM: i.positionM.map((v) => Math.round(v * 10000) / 10000) as SceneItem["positionM"] })),
    ...(look.openItems?.length ? { openItems: [...new Set(look.openItems)].filter((id) => items.some((i) => i.id === id)) } : {}),
    ...(look.sun && Math.round(look.sun.t * 300) !== 100 ? { t: Math.round(look.sun.t * 300) } : {}),
    ...(look.sun && look.sun.headingDeg ? { hd: look.sun.headingDeg } : {}),
    ...(look.sun?.southern ? { sh: 1 as const } : {}),
    ...(look.paint ? { paint: look.paint.replace("#", "") } : {}),
    ...(look.floor ? { floor: look.floor } : {}),
    ...(look.view && look.view !== "leafy" ? { vw: look.view as Plan["vw"] } : {}),
  };
}

export function windowsFromPlan(plan: Plan): WindowSpec[] {
  return plan.win.map((x) => ({
    surface: x.s === "b" ? "back-wall" : "left-wall",
    uM: x.u * INCH_M,
    vM: x.v * INCH_M,
    widthM: x.w * INCH_M,
    heightM: x.h * INCH_M,
    ...(x.k === "d" ? { kind: "door" as const } : {}),
    ...(x.f === "a" ? { shape: "arch" as const } : x.f === "s" ? { shape: "semi" as const } : x.f === "o" ? { shape: "oval" as const } : {}),
    ...(x.c === 1 ? { corner: true as const } : {}),
  }));
}

export function roomFromPlan(plan: Plan): RoomSpec {
  return { widthM: plan.w * INCH_M, depthM: plan.d * INCH_M, heightM: plan.h * INCH_M, gridSizeM: INCH_M, lightingMode: (plan.t ?? 100) > 250 ? "night" : "day" };
}

export function sunFromPlan(plan: Plan): SunSettings {
  return { t: plan.t == null ? DEFAULT_SUN.t : plan.t / 300, headingDeg: plan.hd ?? DEFAULT_SUN.headingDeg, southern: plan.sh === 1 };
}

/** Compact, URL-safe encoding (base64url of UTF-8 JSON). */
export function encodePlan(plan: Plan): string {
  const json = JSON.stringify(plan);
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodePlan(s: string): Plan | null {
  try {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const p = JSON.parse(new TextDecoder().decode(bytes));
    const ok = (n: unknown) => Number.isFinite(n) && (n as number) > 0;
    if (p?.v !== 1 || !ok(p.w) || !ok(p.d) || !ok(p.h) || !Array.isArray(p.win)) return null;
    return {
      v: 1, w: p.w, d: p.d, h: p.h, win: p.win, items: Array.isArray(p.items) ? p.items : [],
      ...(Array.isArray(p.openItems) ? { openItems: [...new Set(p.openItems.filter((id: unknown) => typeof id === "string" && p.items?.some((item: SceneItem) => item?.id === id)))] as string[] } : {}),
      ...(Number.isFinite(p.t) ? { t: Math.min(300, Math.max(0, Math.round(p.t))) }
        : typeof p.t === "string" && p.t in TIME_T ? { t: Math.round(TIME_T[p.t as TimeOfDay] * 300) }
        : p.n === 1 ? { t: 300 } : {}),
      ...(Number.isFinite(p.hd) ? { hd: ((Math.round(p.hd / 45) * 45) % 360 + 360) % 360 } : {}),
      ...(p.sh === 1 ? { sh: 1 as const } : {}),
      ...(typeof p.paint === "string" && /^[0-9a-f]{6}$/i.test(p.paint) ? { paint: p.paint } : {}),
      ...(typeof p.floor === "string" ? { floor: p.floor } : {}),
      ...(["autumn", "snowy", "rainy"].includes(p.vw) ? { vw: p.vw } : {}),
    };
  } catch {
    return null;
  }
}

/** Build a link to this plan. `view` makes it open read-only for the recipient. */
export function planUrl(plan: Plan, view: boolean, base = location.href): string {
  const u = new URL(base);
  u.search = "";
  u.searchParams.set("plan", encodePlan(plan));
  if (view) u.searchParams.set("view", "1");
  return u.toString();
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through */ }
  // http on the LAN is not a secure context; use the legacy path.
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand("copy");
  ta.remove();
  return ok;
}
