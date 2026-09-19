// Click a foot square on a wall → options menu. "Add window" → pick two inch squares
// (top-left, then bottom-right; green) and a window is built from that rectangle.
// Cindy owns this (interactions).
import {
  Camera,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  Plane,
  Raycaster,
  Vector2,
  Vector3,
} from "three";
import type { RoomSpec } from "@contracts";
import { FOOT_M, INCH_M } from "./units";
import { cellAt, fromWallUV, openingsOverlap, sameCell, toWallUV, wallYaw, windowFromCells, type Cell, type WallSurface, type WindowShape, type WindowSpec } from "./wallGrid";
import type { RoomShell } from "../room/buildRoom";

type Mode =
  | { kind: "idle" }
  | { kind: "menu"; surface: WallSurface; cell: Cell }
  | { kind: "remove"; index: number }
  | { kind: "window"; surface: WallSurface; cells: Cell[]; what: "window" | "door"; shape: WindowShape };

const WINDOW_POINTS = 2;
const LIFT = 0.002;

export class WallPicker {
  private mode: Mode = { kind: "idle" };
  private ray = new Raycaster();
  private ndc = new Vector2();
  private down: { x: number; y: number } | null = null;
  private hover: Mesh;
  private footSel: Mesh;
  private selected = new Group();
  readonly windows: WindowSpec[] = [];

  constructor(
    private scene: Object3D,
    private camera: Camera,
    private canvas: HTMLCanvasElement,
    private room: RoomSpec,
    private shell: RoomShell,
    private menu: HTMLElement,
    private onWindowsChanged: (windows: WindowSpec[]) => void = () => {},
  ) {
    this.hover = marker("#48c774", 0.55);
    this.footSel = tile(FOOT_M, "#f2b84b", 0.35);
    this.hover.visible = this.footSel.visible = false;
    scene.add(this.hover, this.footSel, this.selected);

    canvas.addEventListener("pointerdown", (e) => (this.down = { x: e.clientX, y: e.clientY }));
    canvas.addEventListener("pointermove", (e) => this.onMove(e));
    canvas.addEventListener("pointerup", (e) => this.onUp(e));
    window.addEventListener("keydown", (e) => e.key === "Escape" && this.cancel());
    menu.querySelectorAll<HTMLElement>("[data-add-window]").forEach((b) => b.addEventListener("click", () => this.startWindow("window", (b.dataset.shape as WindowShape) || "rect")));
    menu.querySelector("[data-add-door]")!.addEventListener("click", () => this.startWindow("door"));
    menu.querySelector("[data-remove]")!.addEventListener("click", () => this.removeCurrent());
  }

  private hit(e: PointerEvent): { surface: WallSurface; point: Vector3 } | null {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    // Walls have holes, so intersect their planes instead of their meshes and keep the nearest hit
    // that lies within the wall's extents.
    const { widthM: W, depthM: D, heightM: H } = this.room;
    const candidates: Array<{ surface: WallSurface; point: Vector3; dist: number }> = [];
    const back = new Vector3();
    if (this.ray.ray.intersectPlane(new Plane(new Vector3(0, 0, 1), D / 2), back) && back.x >= -W / 2 && back.x <= W / 2 && back.y >= 0 && back.y <= H) {
      candidates.push({ surface: "back-wall", point: back, dist: back.distanceTo(this.ray.ray.origin) });
    }
    const left = new Vector3();
    if (this.ray.ray.intersectPlane(new Plane(new Vector3(1, 0, 0), W / 2), left) && left.z >= -D / 2 && left.z <= D / 2 && left.y >= 0 && left.y <= H) {
      candidates.push({ surface: "left-wall", point: left, dist: left.distanceTo(this.ray.ray.origin) });
    }
    candidates.sort((x, y) => x.dist - y.dist);
    return candidates[0] ?? null;
  }

  /** Index of the window/door under a wall point, if any. */
  private openingAt(surface: WallSurface, u: number, v: number): number {
    return this.windows.findIndex((w) => w.surface === surface && u >= w.uM && u <= w.uM + w.widthM && v >= w.vM && v <= w.vM + w.heightM);
  }

  private onMove(e: PointerEvent) {
    if (this.mode.kind !== "window") return;
    const h = this.hit(e);
    if (!h || h.surface !== this.mode.surface) {
      this.hover.visible = false;
      return;
    }
    const [u, v] = toWallUV(h.surface, h.point, this.room);
    this.place(this.hover, h.surface, cellAt(u, v, INCH_M), INCH_M);
    this.hover.visible = true;
  }

  private onUp(e: PointerEvent) {
    const d = this.down;
    this.down = null;
    if (this.canvas.dataset.busy) return; // a furniture drag/select owns this gesture
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return; // it was an orbit drag
    const h = this.hit(e);

    if (this.mode.kind === "window") {
      if (!h || h.surface !== this.mode.surface) return;
      const [u, v] = toWallUV(h.surface, h.point, this.room);
      if (this.openingAt(h.surface, u, v) >= 0) { this.flash("That spot is already a window or door"); return; }
      const cell = cellAt(u, v, INCH_M);
      if (this.mode.cells.some((c) => sameCell(c, cell))) return;
      this.mode.cells.push(cell);
      const m = marker("#2ecc71", 0.9);
      this.place(m, h.surface, cell, INCH_M);
      this.selected.add(m);
      if (this.mode.cells.length >= WINDOW_POINTS) this.finishWindow();
      return;
    }

    if (!h) {
      this.cancel();
      return;
    }
    const [u, v] = toWallUV(h.surface, h.point, this.room);
    const existing = this.openingAt(h.surface, u, v);
    if (existing >= 0) {
      // Clicked an existing window/door: offer to remove it.
      this.cancel();
      this.mode = { kind: "remove", index: existing };
      const kind = this.windows[existing].kind === "door" ? "door" : "window";
      this.showMenu(e, "remove", `Remove ${kind}`);
      return;
    }
    const cell = cellAt(u, v, FOOT_M);
    this.mode = { kind: "menu", surface: h.surface, cell };
    this.shell.setGridVisible(true);
    this.place(this.footSel, h.surface, cell, FOOT_M);
    this.footSel.visible = true;
    this.showMenu(e, "add");
  }

  private flash(msg: string) {
    const warn = document.getElementById("warn");
    if (!warn) return;
    warn.textContent = msg;
    warn.hidden = false;
    window.setTimeout(() => (warn.hidden = true), 2200);
  }

  private showMenu(e: PointerEvent, which: "add" | "remove", removeLabel = "Remove") {
    const add = this.menu.querySelectorAll<HTMLElement>("[data-add-window],[data-add-door],.menu-label,.menu-row");
    const rem = this.menu.querySelector<HTMLElement>("[data-remove]")!;
    add.forEach((b) => (b.hidden = which !== "add"));
    rem.hidden = which !== "remove";
    rem.textContent = removeLabel;
    this.menu.style.left = `${e.clientX + 8}px`;
    this.menu.style.top = `${e.clientY + 8}px`;
    this.menu.hidden = false;
  }

  private removeCurrent() {
    if (this.mode.kind !== "remove") return;
    this.windows.splice(this.mode.index, 1);
    this.shell.setWindows(this.windows);
    this.onWindowsChanged(this.windows);
    this.cancel();
  }

  private startWindow(what: "window" | "door", shape: WindowShape = "rect") {
    if (this.mode.kind !== "menu") return;
    this.mode = { kind: "window", surface: this.mode.surface, cells: [], what, shape };
    this.canvas.dataset.picking = "1"; // furniture interaction stands down while picking corners
    this.menu.hidden = true;
    this.footSel.visible = false;
    this.canvas.style.cursor = "crosshair";
  }

  private finishWindow() {
    if (this.mode.kind !== "window") return;
    const spec = windowFromCells(this.mode.surface, this.mode.cells, this.mode.what, this.mode.shape);
    if (this.windows.some((w) => openingsOverlap(w, spec))) {
      this.flash(`That ${this.mode.what} would overlap an existing window or door`);
      this.cancel();
      return;
    }
    this.windows.push(spec);
    this.shell.setWindows(this.windows);
    this.onWindowsChanged(this.windows);
    this.cancel();
  }

  cancel() {
    this.mode = { kind: "idle" };
    delete this.canvas.dataset.picking;
    this.shell.setGridVisible(false);
    this.menu.hidden = true;
    this.footSel.visible = this.hover.visible = false;
    this.selected.clear();
    this.canvas.style.cursor = "";
  }

  private place(m: Mesh, surface: WallSurface, cell: Cell, size: number) {
    m.position.copy(fromWallUV(surface, (cell.i + 0.5) * size, (cell.j + 0.5) * size, this.room, LIFT));
    m.rotation.y = wallYaw(surface);
  }
}

/** An exact inch square plus a soft halo so the pick is visible from across the room. */
function marker(color: string, opacity: number): Mesh {
  const m = tile(INCH_M, color, opacity);
  const halo = tile(INCH_M * 4, color, 0.22);
  halo.position.z = -0.0005;
  m.add(halo);
  return m;
}

function tile(size: number, color: string, opacity: number): Mesh {
  return new Mesh(
    new PlaneGeometry(size, size),
    new MeshBasicMaterial({ color: new Color(color), transparent: true, opacity, side: DoubleSide, depthWrite: false }),
  );
}
