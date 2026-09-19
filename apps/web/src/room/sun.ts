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
  // Soft, hazy golden light: wide bloom that spills off sunlit surfaces, yellow-green daylight,
  // gentle contrast. Strongest at sunrise/sunset; midnight stays cool and dim.
  sunrise: { sun: "#ffc070", sunIntensity: 2.8, sky: "#ffe6bd", ground: "#c9a86a", hemiIntensity: 1.1, fill: "#ffdcae", fillIntensity: 0.85, spill: "#ffcf86", spillIntensity: 2.4, bloom: 0.42, bloomThreshold: 0.74, bloomRadius: 0.9, exposure: 1.0, lampsOn: false, bodyClass: "t-sunrise", pane: ["#ffe2a8", "#fff1cc", "#a9c565"] },
  noon: { sun: "#ffe59a", sunIntensity: 2.5, sky: "#fff7d2", ground: "#d3c27c", hemiIntensity: 1.3, fill: "#fff0bf", fillIntensity: 1.1, spill: "#ffe8a6", spillIntensity: 2.4, bloom: 0.4, bloomThreshold: 0.76, bloomRadius: 0.9, exposure: 1.02, lampsOn: false, bodyClass: "t-noon", pane: ["#fff6d2", "#f9efb9", "#a5c96a"] },
  sunset: { sun: "#ffa455", sunIntensity: 3.0, sky: "#ffcf9a", ground: "#a8763f", hemiIntensity: 0.95, fill: "#ffc08a", fillIntensity: 0.7, spill: "#ffb060", spillIntensity: 2.4, bloom: 0.42, bloomThreshold: 0.74, bloomRadius: 0.9, exposure: 0.98, lampsOn: true, bodyClass: "t-sunset", pane: ["#f9ab68", "#ffd9a6", "#7a8a45"] },
  midnight: { sun: "#a9b6f0", sunIntensity: 0.9, sky: "#7580b0", ground: "#332c44", hemiIntensity: 0.55, fill: "#93a0d8", fillIntensity: 0.2, spill: "#93a3f5", spillIntensity: 0.9, bloom: 0.45, bloomThreshold: 0.65, bloomRadius: 0.8, exposure: 0.85, lampsOn: true, bodyClass: "t-midnight", pane: ["#1c2551", "#33427a", "#1f2a3a"] },
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
