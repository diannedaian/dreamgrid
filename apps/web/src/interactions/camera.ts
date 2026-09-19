// Camera orbit / pan / zoom. Cindy owns this (interactions).
import { PerspectiveCamera, Vector3 } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { RoomSpec } from "@contracts";

export function createCamera(room: RoomSpec, canvas: HTMLCanvasElement) {
  const camera = new PerspectiveCamera(45, canvas.clientWidth / canvas.clientHeight, 0.05, 100);
  const controls = new OrbitControls(camera, canvas);

  // Look into the corner formed by the back and left walls, from the open front-right side.
  const reach = Math.max(room.widthM, room.depthM);
  camera.position.set(room.widthM * 0.5 + reach * 0.7, room.heightM * 1.4, room.depthM * 0.5 + reach * 0.7);
  controls.target.set(0, room.heightM * 0.15, 0);
  controls.maxPolarAngle = Math.PI / 2 - 0.02; // never look up from under the floor
  controls.minPolarAngle = 0.05; // top-down is allowed
  controls.minDistance = 0.5;
  controls.maxDistance = reach * 4;
  controls.enableDamping = true;
  controls.update();

  return { camera, controls };
}

export type ViewPreset = "corner" | "top" | "front" | "side";

/** Camera position + target for a preset view of the room. */
export function presetView(room: RoomSpec, kind: ViewPreset): { position: Vector3; target: Vector3 } {
  const { widthM: w, depthM: d, heightM: h } = room;
  const reach = Math.max(w, d);
  const center = new Vector3(0, h * 0.15, 0);
  switch (kind) {
    case "top": return { position: new Vector3(0, reach * 1.9 + h, 0.0001), target: new Vector3(0, 0, 0) }; // +Z nudge: back wall at top of screen
    case "front": return { position: new Vector3(0, h * 0.9, d / 2 + reach * 1.25), target: new Vector3(0, h * 0.35, 0) };
    case "side": return { position: new Vector3(w / 2 + reach * 1.25, h * 0.9, 0), target: new Vector3(0, h * 0.35, 0) };
    default: return { position: new Vector3(w * 0.5 + reach * 0.7, h * 1.4, d * 0.5 + reach * 0.7), target: center };
  }
}

/** Ease the camera toward a preset; returns a per-frame step that reports when done. */
export function animateTo(camera: PerspectiveCamera, controls: OrbitControls, to: { position: Vector3; target: Vector3 }, ms = 450): () => boolean {
  const p0 = camera.position.clone(), t0 = controls.target.clone(), start = performance.now();
  return () => {
    const k = Math.min(1, (performance.now() - start) / ms);
    const e = 1 - Math.pow(1 - k, 3);
    camera.position.lerpVectors(p0, to.position, e);
    controls.target.lerpVectors(t0, to.target, e);
    controls.update();
    return k >= 1;
  };
}
