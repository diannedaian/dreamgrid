// Placed furniture: drop from the catalog, select, drag to the inch, rotate 90°, delete.
// Keeps SceneItem[] (the shared contract) in sync and reports changes upward.
import { Camera, Color, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, Plane, PlaneGeometry, Raycaster, Vector2, Vector3 } from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ModelAsset, Product, RoomSpec, SceneItem } from "@contracts";
import type { Catalog, CatalogEntry } from "../catalog/catalog";
import type { LampRegistry } from "./lamps";
import { loadModel } from "./models";
import { createModelState, type ModelState } from "./modelStates";
import { INCH_M, snapToInch } from "./units";
import { footprintBlocksDoor, type DoorArc } from "./wallGrid";

type Placed = { item: SceneItem; product: Product; object: Object3D; state?: ModelState };

export class PlacementController {
  readonly items: SceneItem[] = [];
  private placed = new Map<string, Placed>();
  private group = new Group();
  private ray = new Raycaster();
  private ndc = new Vector2();
  private floorPlane = new Plane(new Vector3(0, 1, 0), 0);
  private selected: string | null = null;
  private ring: Mesh;
  private drag: { id: string; offset: Vector3; moved: boolean } | null = null;
  private seq = 0;
  private doors: DoorArc[] = [];
  private hovered: Placed | null = null;
  private overlapping = new Set<string>();
  private blockingDoor = new Set<string>();
  private tinted = new Set<string>();
  /** Items the user chose to keep even though they overlap / block a door (no red, no warning). */
  private ignored = new Set<string>();
  private warn: HTMLElement | null = document.getElementById("warn");

  constructor(
    private scene: Object3D,
    private camera: Camera,
    private canvas: HTMLCanvasElement,
    private room: RoomSpec,
    private controls: OrbitControls,
    private catalog: Catalog,
    private lamps: LampRegistry,
    private onChange: (items: SceneItem[]) => void,
    private onDragging: (dragging: boolean) => void = () => {},
    private onSelect: (item: SceneItem | null) => void = () => {},
  ) {
    scene.add(this.group);
    this.ring = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ color: new Color("#48c774"), transparent: true, opacity: 0.35, side: DoubleSide, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.003;
    this.ring.visible = false;
    scene.add(this.ring);

    canvas.addEventListener("pointerdown", (e) => this.onDown(e), { capture: true });
    canvas.addEventListener("pointermove", (e) => this.onMove(e));
    canvas.addEventListener("pointerup", (e) => this.onUp(e));
    window.addEventListener("keydown", (e) => this.onKey(e));
  }

  // ---- public API -------------------------------------------------------

  async add(product: Product, asset: ModelAsset | undefined, positionM: [number, number, number], rotationYDeg: SceneItem["rotationYDeg"] = 0, id?: string): Promise<SceneItem> {
    const object = await loadModel(product, asset);
    const item: SceneItem = { id: id ?? `i${Date.now().toString(36)}${(this.seq++).toString(36)}`, productId: product.id, modelAssetId: asset?.id ?? "", positionM, rotationYDeg };
    this.attach({ item, product, object });
    this.moveTo(item.id, positionM[0], positionM[2], positionM[1]);
    this.emit();
    return item;
  }

  remove(id: string) {
    const p = this.placed.get(id);
    if (!p) return;
    this.lamps.unregister(p.object);
    this.group.remove(p.object);
    this.placed.delete(id);
    this.tinted.delete(id);
    this.ignored.delete(id);
    if (this.hovered === p) this.refreshHover(null);
    this.items.splice(this.items.findIndex((i) => i.id === id), 1);
    if (this.selected === id) this.select(null);
    this.emit();
  }

  rotate(id: string) {
    const p = this.placed.get(id);
    if (!p) return;
    p.item.rotationYDeg = (((p.item.rotationYDeg + 90) % 360) as SceneItem["rotationYDeg"]);
    p.object.rotation.y = (p.item.rotationYDeg * Math.PI) / 180;
    this.moveTo(id, p.item.positionM[0], p.item.positionM[2]); // re-clamp with the new footprint
    this.emit();
    if (this.selected === id) this.onSelect(p.item);
  }

  /**
   * Move an item to (x, z), clamped inside the room and snapped to the inch grid. Height is
   * kept only while the item is against a wall; away from a wall it sits on the floor.
   */
  moveTo(id: string, x: number, z: number, y = this.placed.get(id)?.item.positionM[1] ?? 0) {
    const p = this.placed.get(id);
    if (!p) return;
    const [fw, fd] = this.footprint(p);
    const { widthM: W, depthM: D, heightM: H } = this.room;
    const sx = this.snapClamp(x, W, fw), sz = this.snapClamp(z, D, fd);
    const against = sx - fw / 2 <= -W / 2 + 1e-6 || sz - fd / 2 <= -D / 2 + 1e-6;
    const ih = p.product.dimensionsM[1];
    const sy = against ? Math.min(Math.max(0, snapToInch(y)), Math.max(0, H - ih)) : 0;
    p.item.positionM = [sx, sy, sz];
    p.object.position.set(sx, sy, sz);
    if (this.selected === id) this.placeRing(p);
  }

  /** Is the item touching the back or left wall (so it may be raised)? */
  isAgainstWall(id: string): boolean {
    const p = this.placed.get(id);
    if (!p) return false;
    const [fw, fd] = this.footprint(p);
    return p.item.positionM[0] - fw / 2 <= -this.room.widthM / 2 + 1e-6 || p.item.positionM[2] - fd / 2 <= -this.room.depthM / 2 + 1e-6;
  }

  /** Raise or lower a wall-hugging item by whole inches (clamped to floor and ceiling). */
  raise(id: string, inches: number) {
    const p = this.placed.get(id);
    if (!p || !this.isAgainstWall(id)) return;
    this.moveTo(id, p.item.positionM[0], p.item.positionM[2], p.item.positionM[1] + inches * INCH_M);
    this.emit();
  }

  get selectedItem(): SceneItem | null {
    return this.selected ? this.placed.get(this.selected)?.item ?? null : null;
  }

  get ignoredIds(): string[] { return [...this.ignored].filter((id) => this.placed.has(id)); }

  /** True when the item is red: overlapping or in a door swing, and not ignored. */
  isFlagged(id: string): boolean { return !this.ignored.has(id) && (this.overlapping.has(id) || this.blockingDoor.has(id)); }
  isIgnored(id: string): boolean { return this.ignored.has(id); }

  /** Toggle "ignore overlap" on the selected item. */
  toggleIgnoreSelected(): void {
    if (!this.selected) return;
    const id = this.selected;
    this.ignored.has(id) ? this.ignored.delete(id) : this.ignored.add(id);
    this.applyTints();
    this.refreshHover(this.hovered);
    const p = this.placed.get(id);
    if (p) this.onSelect(p.item);
    this.onChange(this.items);
  }

  get openItemIds(): string[] {
    return [...this.placed.values()].filter((p) => p.state?.isOpen).map((p) => p.item.id);
  }

  stateFor(id: string): ModelState | undefined { return this.placed.get(id)?.state; }

  toggleSelectedState(): void {
    const p = this.selected ? this.placed.get(this.selected) : undefined;
    if (!p?.state) return;
    p.state.setOpen(!p.state.isOpen);
    this.emit();
    this.onSelect(p.item);
  }

  /** World point above the selected item, for anchoring a toolbar on screen. */
  selectedAnchor(): Vector3 | null {
    const p = this.selected ? this.placed.get(this.selected) : undefined;
    if (!p) return null;
    return new Vector3(p.item.positionM[0], p.item.positionM[1] + p.product.dimensionsM[1] + 0.12, p.item.positionM[2]);
  }

  rotateSelected() { if (this.selected) this.rotate(this.selected); }
  removeSelected() { if (this.selected) this.remove(this.selected); }
  raiseSelected(inches: number) { if (this.selected) this.raise(this.selected, inches); }

  async loadItems(items: SceneItem[], openItemIds: string[] = [], ignoredIds: string[] = []) {
    for (const id of ignoredIds) this.ignored.add(id);
    let unavailable = 0;
    for (const it of items) {
      const entry = this.catalog.get(it.productId);
      if (!entry) continue;
      try {
        await this.add(entry.product, entry.asset, it.positionM, it.rotationYDeg, it.id);
        if (openItemIds.includes(it.id)) this.placed.get(it.id)?.state?.setOpen(true);
      } catch {
        // Preserve the saved placement for recovery; do not invent a mesh.
        this.items.push({ ...it });
        unavailable++;
      }
    }
    this.emit();
    if (unavailable && this.warn) {
      this.warn.hidden = false;
      this.warn.textContent = `${unavailable} generated model(s) could not load. Start the backend and reload. Saved placements are preserved.`;
    }
  }

  /** Door swings to check furniture against (hover shows a red warning when something blocks one). */
  setDoors(arcs: DoorArc[]) {
    this.doors = arcs;
    this.updateOverlaps();
    this.refreshHover(this.hovered);
  }

  blocksDoor(p: Placed): boolean {
    const [fw, fd] = this.footprint(p);
    return this.doors.some((a) => footprintBlocksDoor(p.item.positionM[0], p.item.positionM[2], fw, fd, a));
  }

  private refreshHover(p: Placed | null) {
    this.hovered = p;
    const blocked = !!p && !this.ignored.has(p.item.id) && this.blocksDoor(p);
    const overlap = !!p && !this.ignored.has(p.item.id) && this.overlapping.has(p.item.id);
    this.applyTints();
    if (this.warn) {
      this.warn.hidden = !(blocked || overlap);
      if (blocked) this.warn.textContent = `${p!.product.title} is in the way of the door when it opens`;
      else if (overlap) this.warn.textContent = `${p!.product.title} overlaps another item`;
    }
    this.canvas.style.cursor = p ? "grab" : "";
  }

  /** Placed objects, for other tools that need to raycast furniture surfaces. */
  objects(): Object3D[] { return [...this.placed.values()].map((p) => p.object); }

  /** Sidebar drag: a ghost follows the pointer on the floor; release over the room to place. */
  beginCatalogDrag(entry: CatalogEntry, _e: PointerEvent) {
    this.onDragging(true);
    let ghost: Object3D | null = null;
    let last: Vector3 | null = null;
    let cancelled = false;
    loadModel(entry.product, entry.asset).then((obj) => {
      if (cancelled) return;
      obj.traverse((o) => { const m = o as Mesh; if (m.isMesh) { const mat = m.material as MeshStandardMaterial; mat.transparent = true; mat.opacity = 0.55; } });
      ghost = obj;
      ghost.visible = false;
      this.group.add(ghost);
      if (last) { ghost.position.copy(last); ghost.visible = true; }
    });
    const [fw, fd] = rotatedFootprint(entry.product.dimensionsM, 0);
    const { widthM: W, depthM: D } = this.room;
    return {
      move: (e: PointerEvent) => {
        const hit = this.floorHit(e);
        if (!hit) { if (ghost) ghost.visible = false; last = null; return; }
        last = new Vector3(this.snapClamp(hit.x, W, fw), 0, this.snapClamp(hit.z, D, fd));
        if (ghost) { ghost.position.copy(last); ghost.visible = true; }
      },
      end: (e: PointerEvent, wasCancelled: boolean) => {
        cancelled = true;
        this.onDragging(false);
        if (ghost) this.group.remove(ghost);
        const hit = this.floorHit(e);
        if (wasCancelled || !hit || !this.overCanvas(e)) return;
        this.add(entry.product, entry.asset, [hit.x, 0, hit.z]).then((item) => this.select(item.id));
      },
    };
  }

  // ---- internals --------------------------------------------------------

  private attach(p: Placed) {
    p.state = createModelState(p.object, p.product.id);
    p.object.rotation.y = (p.item.rotationYDeg * Math.PI) / 180;
    p.object.userData.itemId = p.item.id;
    this.group.add(p.object);
    this.placed.set(p.item.id, p);
    this.items.push(p.item);
    if (p.product.category === "lamp") this.lamps.registerLamp(p.object);
  }

  private emit() { this.updateOverlaps(); this.onChange(this.items); }

  /** Items whose 3D boxes intersect another item's box are flagged (and tinted red). */
  private updateOverlaps() {
    const list = [...this.placed.values()];
    const boxes = list.map((p) => {
      const [fw, fd] = this.footprint(p);
      const [x, y, z] = p.item.positionM;
      return { id: p.item.id, x0: x - fw / 2, x1: x + fw / 2, z0: z - fd / 2, z1: z + fd / 2, y0: y, y1: y + p.product.dimensionsM[1] };
    });
    const eps = 1e-4;
    this.overlapping.clear();
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.x0 < b.x1 - eps && b.x0 < a.x1 - eps && a.z0 < b.z1 - eps && b.z0 < a.z1 - eps && a.y0 < b.y1 - eps && b.y0 < a.y1 - eps) {
        this.overlapping.add(a.id); this.overlapping.add(b.id);
      }
    }
    this.blockingDoor.clear();
    for (const p of list) if (this.blocksDoor(p)) this.blockingDoor.add(p.item.id);
    this.applyTints();
  }

  /** Red = overlapping another item or sitting in a door's swing. Stays on until fixed. */
  private applyTints() {
    const want = new Set([...this.overlapping, ...this.blockingDoor].filter((id) => !this.ignored.has(id)));
    for (const id of this.tinted) if (!want.has(id)) { const p = this.placed.get(id); if (p) tint(p.object, null); }
    for (const id of want) { const p = this.placed.get(id); if (p) tint(p.object, "#e0523c"); }
    this.tinted = want;
  }

  overlaps(id: string): boolean { return this.overlapping.has(id); }

  private footprint(p: Placed): [number, number] { return rotatedFootprint(p.product.dimensionsM, p.item.rotationYDeg); }

  private snapClamp(v: number, len: number, foot: number): number {
    const half = len / 2, hf = Math.min(foot / 2, half);
    let s = -half + snapToInch(Math.min(half - hf, Math.max(-half + hf, v)) + half);
    if (s + hf > half + 1e-9) s -= INCH_M;
    if (s - hf < -half - 1e-9) s += INCH_M;
    return s;
  }

  private select(id: string | null) {
    this.selected = id;
    const p = id ? this.placed.get(id) : undefined;
    this.ring.visible = !!p;
    if (p) this.placeRing(p);
    this.onSelect(p?.item ?? null);
  }

  private placeRing(p: Placed) {
    const [fw, fd] = this.footprint(p);
    this.ring.scale.set(fw + 0.05, fd + 0.05, 1);
    this.ring.position.set(p.item.positionM[0], 0.003, p.item.positionM[2]);
  }

  private setNdc(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
  }

  private floorHit(e: PointerEvent): Vector3 | null {
    this.setNdc(e);
    const out = new Vector3();
    return this.ray.ray.intersectPlane(this.floorPlane, out) ? out : null;
  }

  private overCanvas(e: PointerEvent): boolean {
    const r = this.canvas.getBoundingClientRect();
    const el = document.elementFromPoint(e.clientX, e.clientY);
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom && (el === this.canvas || el === null);
  }

  private pick(e: PointerEvent): Placed | null {
    this.setNdc(e);
    const hit = this.ray.intersectObjects([...this.placed.values()].map((p) => p.object), true)[0];
    if (!hit) return null;
    let o: Object3D | null = hit.object;
    while (o && !o.userData.itemId) o = o.parent;
    return o ? this.placed.get(o.userData.itemId) ?? null : null;
  }

  private onDown(e: PointerEvent) {
    if (e.button !== 0 || this.canvas.dataset.picking || this.canvas.dataset.measuring) return;
    const p = this.pick(e);
    if (!p) return;
    const hit = this.floorHit(e);
    if (!hit) return;
    this.canvas.dataset.busy = "1"; // tells the wall picker to ignore this gesture
    this.controls.enabled = false;
    this.select(p.item.id);
    this.drag = { id: p.item.id, offset: hit.clone().sub(p.object.position), moved: false };
    this.canvas.setPointerCapture(e.pointerId);
    this.onDragging(true);
  }

  private onMove(e: PointerEvent) {
    if (!this.drag) {
      if (this.canvas.dataset.picking || this.canvas.dataset.measuring) { if (this.hovered) this.refreshHover(null); return; }
      if (!this.canvas.dataset.busy) this.refreshHover(this.pick(e));
      return;
    }
    const hit = this.floorHit(e);
    if (!hit) return;
    this.drag.moved = true;
    this.moveTo(this.drag.id, hit.x - this.drag.offset.x, hit.z - this.drag.offset.z);
    this.updateOverlaps();
    this.refreshHover(this.placed.get(this.drag.id) ?? null);
  }

  private onUp(e: PointerEvent) {
    if (!this.drag) {
      // A plain click on empty floor/wall clears the selection.
      if (this.selected && !this.pick(e) && !this.canvas.dataset.busy) this.select(null);
      return;
    }
    if (this.drag.moved) this.emit();
    const dragged = this.placed.get(this.drag.id);
    this.drag = null;
    this.onDragging(false);
    if (dragged) this.onSelect(dragged.item);
    this.controls.enabled = true;
    setTimeout(() => delete this.canvas.dataset.busy, 0);
  }

  private onKey(e: KeyboardEvent) {
    if (!this.selected || (e.target as HTMLElement)?.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return;
    if (e.key === "r" || e.key === "R") this.rotate(this.selected);
    else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); this.remove(this.selected); }
    else if (e.key === "ArrowUp") { e.preventDefault(); this.raise(this.selected, e.shiftKey ? 12 : 1); }
    else if (e.key === "ArrowDown") { e.preventDefault(); this.raise(this.selected, e.shiftKey ? -12 : -1); }
    else if (e.key === "Escape") this.select(null);
  }
}

/** Emissive tint on every mesh of an object (null clears). */
function tint(obj: Object3D, hex: string | null) {
  obj.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      const sm = mat as MeshStandardMaterial;
      if (!sm.isMeshStandardMaterial) continue;
      if (hex) {
        if (sm.userData.savedEmissive === undefined) { sm.userData.savedEmissive = sm.emissive.getHex(); sm.userData.savedEmissiveI = sm.emissiveIntensity; }
        sm.emissive.set(hex); sm.emissiveIntensity = 0.55;
      } else if (sm.userData.savedEmissive !== undefined) {
        sm.emissive.setHex(sm.userData.savedEmissive); sm.emissiveIntensity = sm.userData.savedEmissiveI;
        delete sm.userData.savedEmissive; delete sm.userData.savedEmissiveI;
      }
    }
  });
}

function rotatedFootprint([w, , d]: [number, number, number], rot: number): [number, number] {
  return rot % 180 === 0 ? [w, d] : [d, w];
}
