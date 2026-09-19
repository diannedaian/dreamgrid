// Tilt rangefinder: with the phone at a known height, the downward angle to where a wall
// meets the floor gives the horizontal distance to that wall. Pure math, unit-tested.

const IN = 0.0254;

/** Camera pitch in degrees (positive = up) from a portrait-held phone's DeviceOrientation beta. */
export function pitchFromBeta(betaDeg: number): number {
  return betaDeg - 90;
}

/** Horizontal distance (m) to a floor point seen `pitchDeg` below level from `phoneHeightM` up. */
export function distanceToFloorPoint(phoneHeightM: number, pitchDeg: number): number | null {
  if (pitchDeg > -3 || pitchDeg < -88) return null; // not looking down enough (or straight down)
  return phoneHeightM / Math.tan((-pitchDeg * Math.PI) / 180);
}

/** Ceiling height (m): phone height plus the rise to a point `distanceM` away seen `pitchDeg` above level. */
export function ceilingHeight(phoneHeightM: number, distanceM: number, pitchDeg: number): number | null {
  if (pitchDeg < 3 || pitchDeg > 88) return null;
  return phoneHeightM + distanceM * Math.tan((pitchDeg * Math.PI) / 180);
}

/** Round to whole inches; `extraIn` accounts for the phone being held in front of the wall at your back. */
export function toInches(m: number, extraIn = 0): number {
  return Math.max(1, Math.round(m / IN + extraIn));
}

export function ftIn(inches: number): string {
  return `${Math.floor(inches / 12)}' ${inches % 12}"`;
}
