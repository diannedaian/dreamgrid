// Approximate sun position from compass orientation, hemisphere, and a continuous time of day.
// t runs 0 → 1 through four checkpoints: sunrise (0), noon (1/3), sunset (2/3), midnight (1).
import { Color, Vector3 } from "three";

export type TimeOfDay = "sunrise" | "noon" | "sunset" | "midnight";
export const TIMES: TimeOfDay[] = ["sunrise", "noon", "sunset", "midnight"];
export const TIME_T: Record<TimeOfDay, number> = { sunrise: 0, noon: 1 / 3, sunset: 2 / 3, midnight: 1 };
export const HEADINGS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

export type SunSettings = {
  /** Time of day, 0..1 (see TIME_T). */
  t: number;
  /** Compass heading (degrees clockwise from north) that the far wall faces, i.e. what you look at from inside. */
  headingDeg: number;
  southern: boolean;
};

export const DEFAULT_SUN: SunSettings = { t: TIME_T.noon, headingDeg: 0, southern: false };

export function nearestTime(t: number): TimeOfDay {
  return TIMES.reduce((best, k) => (Math.abs(TIME_T[k] - t) < Math.abs(TIME_T[best] - t) ? k : best), "noon" as TimeOfDay);
}

/** Snap to a checkpoint when close to it, so the slider "clicks" onto the four named times. */
export function snapT(t: number, tolerance = 0.04): number {
  const k = nearestTime(t);
  return Math.abs(TIME_T[k] - t) <= tolerance ? TIME_T[k] : Math.min(1, Math.max(0, t));
}

/** Azimuth (compass degrees) and elevation of the light source at a checkpoint. */
export function sunAzEl(time: TimeOfDay, southern: boolean): { azDeg: number; elDeg: number } {
  const noonAz = southern ? 0 : 180; // the midday sun sits toward the equator
  switch (time) {
    case "sunrise": return { azDeg: 90, elDeg: 16 };
    case "noon": return { azDeg: noonAz, elDeg: 62 };
    case "sunset": return { azDeg: 270, elDeg: 16 };
    case "midnight": return { azDeg: (noonAz + 180) % 360, elDeg: 42 }; // the moon, roughly opposite
  }
}

function segment(t: number): { a: TimeOfDay; b: TimeOfDay; f: number } {
  const x = Math.min(1, Math.max(0, t)) * 3;
  const i = Math.min(2, Math.floor(x));
  return { a: TIMES[i], b: TIMES[i + 1], f: x - i };
}

const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
const lerpAngle = (a: number, b: number, f: number) => {
  let d = ((b - a + 540) % 360) - 180; // shortest arc
  return (a + d * f + 360) % 360;
};
const lerpColor = (a: string, b: string, f: number) => `#${new Color(a).lerp(new Color(b), f).getHexString()}`;

/** Interpolated azimuth/elevation for any time of day. */
export function sunAzElAt(t: number, southern: boolean): { azDeg: number; elDeg: number } {
  const { a, b, f } = segment(t);
  const A = sunAzEl(a, southern), B = sunAzEl(b, southern);
  return { azDeg: lerpAngle(A.azDeg, B.azDeg, f), elDeg: lerp(A.elDeg, B.elDeg, f) };
}

/**
 * Unit vector from the room toward the light source in world space.
 * World −Z is the direction the far (back) wall faces (heading `headingDeg`); world +X is 90° clockwise from it.
 */
export function toSunVector(s: SunSettings): Vector3 {
  const { azDeg, elDeg } = sunAzElAt(s.t, s.southern);
  const phi = ((azDeg - s.headingDeg) * Math.PI) / 180;
  const el = (elDeg * Math.PI) / 180;
  return new Vector3(Math.cos(el) * Math.sin(phi), Math.sin(el), -Math.cos(el) * Math.cos(phi)).normalize();
}

export type Look = {
  sun: string; sunIntensity: number;
  sky: string; ground: string; hemiIntensity: number;
  fill: string; fillIntensity: number;
  spill: string; spillIntensity: number;
  bloom: number; bloomThreshold: number; bloomRadius: number; exposure: number;
  lampsOn: boolean;
  /** Body class for the page palette (nearest checkpoint). */
  bodyClass: string;
  /** Pane gradient stops, top → horizon → ground. */
  pane: [string, string, string];
};

export const LOOKS: Record<TimeOfDay, Look> = {
  // The day's arc: pink at sunrise → whitest (warm) at noon → orange toward sunset → no light at midnight.
  // Soft, hazy bloom throughout the day. Slider values blend between these.
  sunrise: { sun: "#ffb39a", sunIntensity: 2.6, sky: "#ffd6c6", ground: "#d0a07a", hemiIntensity: 1.05, fill: "#ffc8b3", fillIntensity: 0.8, spill: "#ffb89c", spillIntensity: 1.8, bloom: 0.36, bloomThreshold: 0.78, bloomRadius: 0.9, exposure: 1.0, lampsOn: false, bodyClass: "t-sunrise", pane: ["#ffd6c2", "#ffe9d8", "#a9c56a"] },
  noon: { sun: "#fff0c4", sunIntensity: 2.1, sky: "#fff9ea", ground: "#d9c88a", hemiIntensity: 1.2, fill: "#fff3cc", fillIntensity: 1.0, spill: "#ffefbd", spillIntensity: 1.7, bloom: 0.32, bloomThreshold: 0.8, bloomRadius: 0.9, exposure: 1.0, lampsOn: false, bodyClass: "t-noon", pane: ["#fff8e6", "#fdf3c8", "#aacb5e"] },
  sunset: { sun: "#ff8a30", sunIntensity: 2.8, sky: "#ffb56a", ground: "#a86f2c", hemiIntensity: 0.9, fill: "#ffa650", fillIntensity: 0.65, spill: "#ff9a3e", spillIntensity: 1.8, bloom: 0.36, bloomThreshold: 0.78, bloomRadius: 0.9, exposure: 0.98, lampsOn: true, bodyClass: "t-sunset", pane: ["#ff9e4a", "#ffcd8a", "#7a8a45"] },
  midnight: { sun: "#9fb0e8", sunIntensity: 0.25, sky: "#6b74a3", ground: "#2c2740", hemiIntensity: 0.45, fill: "#8a95c8", fillIntensity: 0.15, spill: "#8fa0f0", spillIntensity: 0, bloom: 0.25, bloomThreshold: 0.9, bloomRadius: 0.8, exposure: 0.85, lampsOn: true, bodyClass: "t-midnight", pane: ["#141b3d", "#25305e", "#161e2c"] },
};

/** The look for any time of day, blended between the two nearest checkpoints. */
export function lookAt(t: number): Look {
  const { a, b, f } = segment(t);
  const A = LOOKS[a], B = LOOKS[b];
  return {
    sun: lerpColor(A.sun, B.sun, f), sunIntensity: lerp(A.sunIntensity, B.sunIntensity, f),
    sky: lerpColor(A.sky, B.sky, f), ground: lerpColor(A.ground, B.ground, f), hemiIntensity: lerp(A.hemiIntensity, B.hemiIntensity, f),
    fill: lerpColor(A.fill, B.fill, f), fillIntensity: lerp(A.fillIntensity, B.fillIntensity, f),
    spill: lerpColor(A.spill, B.spill, f), spillIntensity: lerp(A.spillIntensity, B.spillIntensity, f),
    bloom: lerp(A.bloom, B.bloom, f), bloomThreshold: lerp(A.bloomThreshold, B.bloomThreshold, f), bloomRadius: lerp(A.bloomRadius, B.bloomRadius, f), exposure: lerp(A.exposure, B.exposure, f),
    lampsOn: t >= 0.55, // lamps come on in the late afternoon
    bodyClass: LOOKS[nearestTime(t)].bodyClass,
    pane: [lerpColor(A.pane[0], B.pane[0], f), lerpColor(A.pane[1], B.pane[1], f), lerpColor(A.pane[2], B.pane[2], f)],
  };
}

export function headingLabel(deg: number): string {
  return HEADINGS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}
