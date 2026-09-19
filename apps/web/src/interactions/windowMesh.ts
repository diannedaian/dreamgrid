// Window: just the hole (cut by the room shell), a pane showing the outside, and a soft
// area light that spills light into the room.
import {
  Color,
  Group,
  Mesh,
  RectAreaLight,
} from "three";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";
import type { RoomSpec } from "@contracts";
import { fromWallUV, wallYaw, type WindowSpec } from "./wallGrid";
import { lookAt } from "../room/sun";
import { buildOutside, type OutsideView } from "../room/outside";

let rectInit = false;

export function buildWindowDressing(spec: WindowSpec, room: RoomSpec, wallT: number, t = 1 / 3, view: OutsideView = "leafy", pageBg = "#adbc9c"): Group {
  const look = lookAt(t);
  if (!rectInit) { RectAreaLightUniformsLib.init(); rectInit = true; }
  const g = new Group();
  const { widthM: w, heightM: h } = spec;

  // The view outside: a little diorama box behind the wall (sky, tree, weather).
  const wallLen = spec.surface === "back-wall" ? room.widthM : room.depthM;
  // Local +x runs along the wall; on the left wall the dressing is anchored at the far edge (see below),
  // so the "left" limit there is the run toward the front of the room.
  // Keep a margin from the wall's edges so the box's open face never peeks past the wall at grazing angles.
  const M = 0.15;
  const before = Math.max(0, spec.uM - M), after = Math.max(0, wallLen - spec.uM - w - M);
  // Seed from the window's placement so its leaves stay put when the sun or view changes.
  const seed = Math.round(spec.uM * 1000) * 7919 + Math.round(spec.vM * 1000) * 104729 + Math.round(w * 1000) * 31 + Math.round(h * 1000) + (spec.surface === "back-wall" ? 0 : 1);
  const outside = buildOutside(w, h, wallT, look, view, pageBg, {
    up: Math.max(0, room.heightM - spec.vM - h - M), down: Math.max(0, spec.vM - 0.05),
    left: spec.surface === "back-wall" ? before : after, right: spec.surface === "back-wall" ? after : before,
  }, seed, spec.shape ?? "rect");
  g.add(outside.group);
  g.userData.update = outside.update;
  g.userData.render = outside.render;
  g.userData.dispose = outside.dispose;

  // Warm spill light from the window into the room.
  const light = new RectAreaLight(new Color(look.spill), look.spillIntensity, w, h);
  light.position.set(w / 2, h / 2, 0.02);
  light.lookAt(w / 2, h / 2, 1);
  g.add(light);

  // wallYaw maps local +Z into the room on both walls, but on the left wall it sends local +X
  // toward −Z, so anchor that wall's dressing at the window's far edge to keep it in the hole.
  const anchorU = spec.surface === "left-wall" ? spec.uM + w : spec.uM;
  g.position.copy(fromWallUV(spec.surface, anchorU, spec.vM, room));
  g.rotation.y = wallYaw(spec.surface);
  g.userData.window = spec;
  return g;
}

