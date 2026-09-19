// Camera orbit / pan / zoom. Cindy owns this (interactions).
import { PerspectiveCamera } from "three";
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
