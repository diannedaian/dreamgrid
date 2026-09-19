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
  bloom: number; bloomThreshold: number; exposure: number;
  lampsOn: boolean;
  /** Body class for the page palette (nearest checkpoint). */
  bodyClass: string;
  /** Pane gradient stops, top → horizon → ground. */
  pane: [string, string, string];
};

export const LOOKS: Record<TimeOfDay, Look> = {
  sunrise: { sun: "#ffb46e", sunIntensity: 3.2, sky: "#ffe0c4", ground: "#b58a6a", hemiIntensity: 1.0, fill: "#ffd6b8", fillIntensity: 0.8, spill: "#ffc48a", spillIntensity: 2.0, bloom: 0.3, bloomThreshold: 0.8, exposure: 1.0, lampsOn: false, bodyClass: "t-sunrise", pane: ["#ffd9a8", "#ffe9c9", "#8fb86a"] },
  noon: { sun: "#ffdcae", sunIntensity: 2.3, sky: "#fff7ea", ground: "#c9b08a", hemiIntensity: 1.4, fill: "#ffe9d0", fillIntensity: 1.1, spill: "#ffe3b8", spillIntensity: 2.2, bloom: 0.16, bloomThreshold: 0.9, exposure: 1.0, lampsOn: false, bodyClass: "t-noon", pane: ["#fff9e6", "#e9f3d2", "#8fbf6a"] },
  sunset: { sun: "#ff9a5c", sunIntensity: 3.4, sky: "#ffc9a8", ground: "#8a5e4c", hemiIntensity: 0.85, fill: "#ffb99a", fillIntensity: 0.6, spill: "#ffa36a", spillIntensity: 2.2, bloom: 0.26, bloomThreshold: 0.85, exposure: 0.95, lampsOn: true, bodyClass: "t-sunset", pane: ["#f7a56b", "#ffd2a6", "#5f7a4a"] },
  midnight: { sun: "#a9bcff", sunIntensity: 0.9, sky: "#6f7fb8", ground: "#2a2c48", hemiIntensity: 0.55, fill: "#8fa4e0", fillIntensity: 0.18, spill: "#8fa6ff", spillIntensity: 0.9, bloom: 0.38, bloomThreshold: 0.7, exposure: 0.85, lampsOn: true, bodyClass: "t-midnight", pane: ["#1c2551", "#33427a", "#1f2a3a"] },
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
    bloom: lerp(A.bloom, B.bloom, f), bloomThreshold: lerp(A.bloomThreshold, B.bloomThreshold, f), exposure: lerp(A.exposure, B.exposure, f),
    lampsOn: t >= 0.55, // lamps come on in the late afternoon
    bodyClass: LOOKS[nearestTime(t)].bodyClass,
    pane: [lerpColor(A.pane[0], B.pane[0], f), lerpColor(A.pane[1], B.pane[1], f), lerpColor(A.pane[2], B.pane[2], f)],
  };
}

export function headingLabel(deg: number): string {
  return HEADINGS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}
