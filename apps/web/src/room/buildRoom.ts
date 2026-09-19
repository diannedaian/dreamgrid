// PLACEHOLDER room shell so interaction work can proceed before Dianne's room lands.
// Dianne owns src/room/. Keep the RoomShell surface (group, walls, setWindows) if replacing.
import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Shape,
  Path,
  Vector3,
  WebGLRenderer,
} from "three";
import type { RoomSpec } from "@contracts";
import { FOOT_M, INCH_M } from "../interactions/units";
import { doorArc, type WindowSpec } from "../interactions/wallGrid";
import { buildWindowDressing } from "../interactions/windowMesh";
import { DEFAULT_SUN, lookAt, nearestTime, toSunVector, type SunSettings } from "./sun";
import { DEFAULT_VIEW, viewLighting, type OutsideView } from "./outside";
import { DEFAULT_FLOOR, DEFAULT_PAINT, floorPreset, makeFloorTexture } from "./floors";

const WALL_T = 0.1;
/** Page background per time of day (mirrors the CSS), used to camouflage window dioramas. */
const PAGE_BG = { sunrise: "#c6bf9c", noon: "#adbc9c", sunset: "#b9a487", midnight: "#3f4a5e" } as const;

export class RoomShell {
  readonly group = new Group();
  walls: Mesh[] = [];
  private wallGroup = new Group();
  private windowGroup = new Group();
  private wallMat = new MeshStandardMaterial({ color: new Color("#f4e6d2"), roughness: 1, metalness: 0 });
  private lights!: ReturnType<typeof buildLights>;
  private windows: WindowSpec[] = [];
  private floorMat!: MeshStandardMaterial;
  private floorGrid!: { minor: LineBasicMaterial; major: LineBasicMaterial };
  private grid!: Group;
  private highlight: Mesh | null = null;
  sun: SunSettings = { ...DEFAULT_SUN };
  view: OutsideView = DEFAULT_VIEW;
  private updaters: Array<(dt: number, time: number) => void> = [];
  private renderers: Array<(r: WebGLRenderer) => void> = [];
  private disposers: Array<() => void> = [];
  paint = DEFAULT_PAINT;
  floor = DEFAULT_FLOOR;

  constructor(private room: RoomSpec) {
    const { widthM: w, depthM: d, heightM: h } = room;
    const g = this.group;

    // Floor, top face at y = 0. Surface comes from a preset (see floors.ts).
    this.floorMat = new MeshStandardMaterial({ roughness: 0.6, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    const floor = new Mesh(new BoxGeometry(w, 0.05, d), this.floorMat);
    floor.position.y = -0.025;
    floor.receiveShadow = true;
    g.add(floor);

    // Soft drop shadow under the diorama.
    const drop = new Mesh(new PlaneGeometry(w * 1.6, d * 1.6), new MeshBasicMaterial({ map: makeDropShadow(), transparent: true, depthWrite: false }));
    drop.rotation.x = -Math.PI / 2;
    drop.position.y = -0.06;
    g.add(drop);

    // Baseboards.
    const trimMat = new MeshStandardMaterial({ color: new Color("#fbf3e8"), roughness: 0.8 });
    const trimH = 0.08, trimT = 0.012;
    const backTrim = new Mesh(new BoxGeometry(w, trimH, trimT), trimMat);
    backTrim.position.set(0, trimH / 2, -d / 2 + trimT / 2);
    const leftTrim = new Mesh(new BoxGeometry(trimT, trimH, d), trimMat);
    leftTrim.position.set(-w / 2 + trimT / 2, trimH / 2, 0);
    g.add(backTrim, leftTrim);

    // Invisible occluders (ceiling, front, right) so sunlight only enters through windows.
    const occMat = new MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    const ceil = new Mesh(new BoxGeometry(w + 2 * WALL_T, WALL_T, d + 2 * WALL_T), occMat);
    ceil.position.set(0, h + WALL_T / 2, 0);
    const front = new Mesh(new BoxGeometry(w + 2 * WALL_T, h + WALL_T, WALL_T), occMat);
    front.position.set(0, h / 2, d / 2 + WALL_T / 2);
    const right = new Mesh(new BoxGeometry(WALL_T, h + WALL_T, d + 2 * WALL_T), occMat);
    right.position.set(w / 2 + WALL_T / 2, h / 2, 0);
    for (const o of [ceil, front, right]) { o.castShadow = true; g.add(o); }

    this.lights = buildLights(room);
    const grids = buildGrids(room);
    this.floorGrid = grids.floor;
    this.grid = grids.group;
    this.grid.visible = false; // shown only while something is being placed or moved
    g.add(this.wallGroup, this.windowGroup, grids.group, this.lights.hemi, this.lights.fill, this.lights.sun, this.lights.sun.target);
    this.setFloor(DEFAULT_FLOOR);
    this.setSun(this.sun);
  }

  /** Repaint both walls (hex color). */
  setWallColor(hex: string) {
    this.paint = hex;
    this.wallMat.color.set(hex);
  }

  /** Swap the floor surface for a preset from floors.ts. */
  setFloor(key: string) {
    const preset = floorPreset(key);
    this.floor = preset.key;
    this.floorMat.map?.dispose();
    this.floorMat.map = makeFloorTexture(preset, this.room.widthM, this.room.depthM);
    this.floorMat.normalMap = null;
    this.floorMat.color.set("#ffffff");
    this.floorMat.roughness = preset.roughness;
    this.floorMat.needsUpdate = true;
    const ink = preset.gridInk === "light" ? "#9ec2ff" : "#5b83d6"; // dreamy blue, deeper on pale floors
    this.floorGrid.minor.color.set(ink);
    this.floorGrid.major.color.set(ink);
    this.gridBase = [0.18, 0.6];
    this.applyGridDim();
  }

  private gridBase: [number, number] = [0.08, 0.4];
  private applyGridDim() {
    const dim = nearestTime(this.sun.t) === "midnight" ? 0.5 : 1;
    this.floorGrid.minor.opacity = this.gridBase[0] * dim;
    this.floorGrid.major.opacity = this.gridBase[1] * dim;
  }

  /** Choose what's outside the windows (leafy, autumn, snowy, rainy). */
  setView(view: OutsideView) {
    this.view = view;
    this.setSun(this.sun); // re-tints the light and rebuilds the windows
  }

  /** Advance window animations and render each window's outside view into its pane. */
  update(dt: number, time: number, renderer?: WebGLRenderer) {
    for (const u of this.updaters) u(dt, time);
    if (renderer) for (const r of this.renderers) r(renderer);
  }

  /** Show the inch grid (while dragging or picking a window). */
  setGridVisible(on: boolean) {
    this.grid.visible = on;
  }

  /** Tint a wall so the user can see which one a setting refers to (null clears). */
  setWallHighlight(surface: "back-wall" | "left-wall" | null) {
    if (this.highlight) { this.group.remove(this.highlight); this.highlight = null; }
    if (!surface) return;
    const { widthM: w, depthM: d, heightM: h } = this.room;
    const m = new Mesh(
      new PlaneGeometry(surface === "back-wall" ? w : d, h),
      new MeshBasicMaterial({ color: new Color("#8fb3ff"), transparent: true, opacity: 0.28, depthWrite: false }),
    );
    if (surface === "back-wall") m.position.set(0, h / 2, -d / 2 + 0.004);
    else { m.position.set(-w / 2 + 0.004, h / 2, 0); m.rotation.y = Math.PI / 2; }
    this.highlight = m;
    this.group.add(m);
  }

  /** Aim and color the sun (or moon) from compass heading, hemisphere, and time of day. */
  setSun(settings: SunSettings) {
    this.sun = { ...settings };
    this.room.lightingMode = nearestTime(settings.t) === "midnight" ? "night" : "day";
    const look = lookAt(settings.t);
    const wx = viewLighting(this.view);
    const cool = (hex: string) => new Color(hex).lerp(new Color("#9fb4d6"), wx.cool * 0.5);
    const { hemi, fill, sun } = this.lights;
    hemi.color.copy(cool(look.sky)); hemi.groundColor.copy(cool(look.ground)); hemi.intensity = look.hemiIntensity * wx.hemiScale;
    fill.color.copy(cool(look.fill)); fill.intensity = look.fillIntensity;
    sun.color.copy(cool(look.sun)); sun.intensity = look.sunIntensity * wx.sunScale;
    const { widthM: w, depthM: d, heightM: h } = this.room;
    const reach = Math.max(w, d, h);
    sun.position.copy(toSunVector(settings).multiplyScalar(reach * 2.5)).add(new Vector3(0, h / 2, 0));
    this.applyGridDim();
    this.setWindows(this.windows);
  }

  /** Rebuild both walls with holes cut for the given windows, plus each window's dressing. */
  setWindows(windows: WindowSpec[]) {
    this.windows = windows;
    this.wallGroup.clear();
    this.windowGroup.clear();
    const { widthM: w, depthM: d, heightM: h } = this.room;

    const back = wallWithHoles(w, h, windows.filter((x) => x.surface === "back-wall"), this.wallMat);
    back.position.set(-w / 2, 0, -d / 2 - WALL_T);
    back.userData.surface = "back-wall";

    const left = wallWithHoles(d, h, windows.filter((x) => x.surface === "left-wall"), this.wallMat);
    left.rotation.y = -Math.PI / 2; // local +X → world +Z, local +Z → world −X
    left.position.set(-w / 2, 0, -d / 2);
    left.userData.surface = "left-wall";

    // Corner post covers the back wall's exposed end.
    const post = new Mesh(new BoxGeometry(WALL_T, h, WALL_T), this.wallMat);
    post.position.set(-w / 2 - WALL_T / 2, h / 2, -d / 2 - WALL_T / 2);

    for (const m of [back, left, post]) { m.castShadow = true; m.receiveShadow = true; }
    this.wallGroup.add(back, left, post);
    this.walls = [back, left];

    for (const d of this.disposers) d();
    this.updaters = []; this.renderers = []; this.disposers = [];
    for (const spec of windows) {
      if (spec.kind === "door") this.windowGroup.add(doorSwingArc(spec, this.room));
      else {
        const d = buildWindowDressing(spec, this.room, WALL_T, this.sun.t, this.view, PAGE_BG[nearestTime(this.sun.t)]);
        if (d.userData.update) this.updaters.push(d.userData.update);
        if (d.userData.render) this.renderers.push(d.userData.render);
        if (d.userData.dispose) this.disposers.push(d.userData.dispose);
        this.windowGroup.add(d);
      }
    }
  }
}

/** Faint quarter-circle on the floor showing where an inward-opening door swings. */
function doorSwingArc(spec: WindowSpec, room: RoomSpec): Group {
  const arc = doorArc(spec, room);
  const pts: number[] = [];
  const n = 32;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * (Math.PI / 2), a1 = ((i + 1) / n) * (Math.PI / 2);
    pts.push(arc.cx + arc.sx * Math.cos(a0) * arc.r, 0.003, arc.cz + arc.sz * Math.sin(a0) * arc.r);
    pts.push(arc.cx + arc.sx * Math.cos(a1) * arc.r, 0.003, arc.cz + arc.sz * Math.sin(a1) * arc.r);
  }
  // the door leaf itself, fully open
  pts.push(arc.cx, 0.003, arc.cz, arc.cx, 0.003, arc.cz + arc.sz * arc.r);
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(pts, 3));
  const g = new Group();
  g.add(new LineSegments(geo, new LineBasicMaterial({ color: new Color("#8fb3ff"), transparent: true, opacity: 0.55 })));
  return g;
}

/** A wall in its own plane: u along +X (0..len), v up +Y (0..h), extruded WALL_T toward +Z. */
function wallWithHoles(len: number, h: number, windows: WindowSpec[], mat: MeshStandardMaterial): Mesh {
  const shape = new Shape();
  shape.moveTo(0, 0); shape.lineTo(len, 0); shape.lineTo(len, h); shape.lineTo(0, h); shape.closePath();
  for (const win of windows) {
    const hole = new Path();
    hole.moveTo(win.uM, win.vM);
    hole.lineTo(win.uM + win.widthM, win.vM);
    hole.lineTo(win.uM + win.widthM, win.vM + win.heightM);
    hole.lineTo(win.uM, win.vM + win.heightM);
    hole.closePath();
    shape.holes.push(hole);
  }
  const geo = new ExtrudeGeometry(shape, { depth: WALL_T, bevelEnabled: false });
  return new Mesh(geo, mat);
}

function buildLights(room: RoomSpec) {
  const { widthM: w, depthM: d, heightM: h } = room;
  const reach = Math.max(w, d, h);

  // Soft sky/ground ambience.
  const hemi = new HemisphereLight(new Color("#fff7ea"), new Color("#c9b08a"), 1.4);

  // Gentle fill from the open side so the room reads even with no windows.
  const fill = new DirectionalLight(new Color("#ffe9d0"), 1.1);
  fill.position.set(w * 0.9, h * 1.4, d * 1.1);

  // The sun: only reaches the floor through window holes (occluders block the rest). Aimed by setSun().
  const sun = new DirectionalLight(new Color("#ffdcae"), 2.3);
  sun.target.position.set(0, h / 2, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.01;
  sun.shadow.radius = 3;
  sun.shadow.blurSamples = 12;
  Object.assign(sun.shadow.camera, { left: -reach * 1.3, right: reach * 1.3, top: reach * 1.3, bottom: -reach * 1.3, near: 0.1, far: reach * 6 });

  return { hemi, fill, sun };
}

function buildGrids(room: RoomSpec): { group: Group; floor: { minor: LineBasicMaterial; major: LineBasicMaterial } } {
  const { widthM: w, depthM: d, heightM: h, gridSizeM: step } = room;
  const minor: number[] = [], major: number[] = [], fMinor: number[] = [], fMajor: number[] = [];
  const majorEvery = Math.round(FOOT_M / step);
  const lift = 0.0015;
  const nx = Math.round(w / step), ny = Math.round(h / step), nz = Math.round(d / step);
  const pick = (i: number) => (i % majorEvery === 0 ? major : minor);
  const pickF = (i: number) => (i % majorEvery === 0 ? fMajor : fMinor);

  for (let i = 0; i <= nx; i++) { const x = -w / 2 + i * step; pickF(i).push(x, lift, -d / 2, x, lift, d / 2); }
  for (let j = 0; j <= nz; j++) { const z = -d / 2 + j * step; pickF(j).push(-w / 2, lift, z, w / 2, lift, z); }
  const zb = -d / 2 + lift;
  for (let i = 0; i <= nx; i++) { const x = -w / 2 + i * step; pick(i).push(x, 0, zb, x, h, zb); }
  for (let k = 0; k <= ny; k++) { const y = k * step; pick(k).push(-w / 2, y, zb, w / 2, y, zb); }
  const xl = -w / 2 + lift;
  for (let j = 0; j <= nz; j++) { const z = -d / 2 + j * step; pick(j).push(xl, 0, z, xl, h, z); }
  for (let k = 0; k <= ny; k++) { const y = k * step; pick(k).push(xl, y, -d / 2, xl, y, d / 2); }

  const mk = (pts: number[], color: string, opacity: number) => {
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(pts, 3));
    return new LineSegments(geo, new LineBasicMaterial({ color: new Color(color), transparent: true, opacity }));
  };
  const grid = new Group();
  grid.add(mk(minor, "#8fb3ff", 0.14), mk(major, "#8fb3ff", 0.42));
  const fMinorL = mk(fMinor, "#9ec2ff", 0.18), fMajorL = mk(fMajor, "#9ec2ff", 0.6);
  grid.add(fMinorL, fMajorL);
  return { group: grid, floor: { minor: fMinorL.material as LineBasicMaterial, major: fMajorL.material as LineBasicMaterial } };
}

function makeDropShadow(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(128, 128, 40, 128, 128, 128);
  g.addColorStop(0, "rgba(40, 50, 30, 0.35)");
  g.addColorStop(1, "rgba(40, 50, 30, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return new CanvasTexture(c);
}
