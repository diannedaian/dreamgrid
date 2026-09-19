// Unit conversion and grid snapping. Cindy owns this (interactions).
// Internal geometry is meters; the placement grid is 1 inch.

export const INCH_M = 0.0254;
export const FOOT_M = 12 * INCH_M;

export function feetInchesToM(feet: number, inches: number): number {
  return (feet * 12 + inches) * INCH_M;
}

export function mToInches(m: number): number {
  return m / INCH_M;
}

/** Snap a meter value to the nearest whole inch. */
export function snapToInch(m: number): number {
  return Math.round(m / INCH_M) * INCH_M;
}

/**
 * Snap a floor position (x, z in meters, room-centered origin) to the inch grid
 * and clamp it inside the room. The grid is anchored at the room's back-left
 * corner so every line falls on a whole inch from the walls.
 */
export function snapToRoomGrid(
  x: number,
  z: number,
  widthM: number,
  depthM: number,
): [x: number, z: number] {
  const halfW = widthM / 2;
  const halfD = depthM / 2;
  const sx = -halfW + snapToInch(x + halfW);
  const sz = -halfD + snapToInch(z + halfD);
  return [Math.min(halfW, Math.max(-halfW, sx)), Math.min(halfD, Math.max(-halfD, sz))];
}

/** Where an item is mounted. Nothing floats: it is on the floor or flush to a wall. */
export type Surface = "floor" | "back-wall" | "left-wall";

/**
 * Snap a 3D position to the inch grid on the given surface and clamp it to the room.
 * - floor: y is pinned to 0, x/z snap on the floor grid.
 * - back-wall (−Z): z is pinned to the wall, x and y snap on the wall grid.
 * - left-wall (−X): x is pinned to the wall, z and y snap on the wall grid.
 */
export function snapToSurface(
  surface: Surface,
  [x, y, z]: [number, number, number],
  room: { widthM: number; depthM: number; heightM: number },
): [x: number, y: number, z: number] {
  const [sx, sz] = snapToRoomGrid(x, z, room.widthM, room.depthM);
  const sy = Math.min(room.heightM, Math.max(0, snapToInch(y)));
  switch (surface) {
    case "floor":
      return [sx, 0, sz];
    case "back-wall":
      return [sx, sy, -room.depthM / 2];
    case "left-wall":
      return [-room.widthM / 2, sy, sz];
  }
}
