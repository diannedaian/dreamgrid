// Measure tool: click two points (floor, walls or furniture) to get the distance to the inch.
import { BufferGeometry, Camera, Color, Float32BufferAttribute, Line, LineBasicMaterial, Mesh, MeshBasicMaterial, Object3D, Plane, Raycaster, SphereGeometry, Vector2, Vector3 } from "three";
import type { RoomSpec } from "@contracts";
import { INCH_M, snapToInch } from "./units";

export class MeasureTool {
  active = false;
  private points: Vector3[] = [];
  private ray = new Raycaster();
  private ndc = new Vector2();
  private markers: Mesh[] = [];
  private line: Line;
  private hoverPoint: Vector3 | null = null;
  private once: ((meters: number) => void) | null = null;

  constructor(
    private scene: Object3D,
    private camera: Camera,
    private canvas: HTMLCanvasElement,
    private room: RoomSpec,
    private pickables: () => Object3D[],
    private label: HTMLElement,
    private onChange: (active: boolean) => void,
  ) {
    this.line = new Line(new BufferGeometry(), new LineBasicMaterial({ color: new Color("#4d78d6"), depthTest: false, transparent: true, opacity: 0.95 }));
    this.line.renderOrder = 20;
    this.line.visible = false;
    scene.add(this.line);
    for (let i = 0; i < 2; i++) {
      const m = new Mesh(new SphereGeometry(0.022, 16, 16), new MeshBasicMaterial({ color: new Color("#4d78d6"), depthTest: false }));
      m.renderOrder = 21; m.visible = false;
      scene.add(m); this.markers.push(m);
    }
    canvas.addEventListener("pointerup", (e) => this.onUp(e));
    canvas.addEventListener("pointermove", (e) => this.onMove(e));
    window.addEventListener("keydown", (e) => { if (e.key === "Escape" && this.active) this.stop(); });
  }

  toggle() { this.active ? this.stop() : this.start(); }

  /** Start measuring; call `cb` with the distance (meters) once two points are picked, then stop. */
  measureOnce(cb: (meters: number) => void) {
    this.once = cb;
    this.start();
  }

  start() {
    this.active = true;
    this.points = [];
    this.canvas.dataset.measuring = "1";
    this.canvas.style.cursor = "crosshair";
    this.render();
    this.onChange(true);
  }

  stop() {
    this.active = false;
    this.points = [];
    this.hoverPoint = null;
    this.once = null;
    delete this.canvas.dataset.measuring;
    this.canvas.style.cursor = "";
    this.render();
    this.onChange(false);
  }

  /** World midpoint of the current measurement, for the on-screen label. */
  labelAnchor(): { point: Vector3; text: string } | null {
    const b = this.points[1] ?? this.hoverPoint;
    if (!this.active || !this.points[0] || !b) return null;
    const d = this.points[0].distanceTo(b);
    return { point: this.points[0].clone().add(b).multiplyScalar(0.5), text: fmt(d) };
  }

  private pick(e: PointerEvent): Vector3 | null {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    const { widthM: W, depthM: D, heightM: H } = this.room;
    const hits: Array<{ p: Vector3; dist: number }> = [];
    // furniture surfaces
    const objHit = this.ray.intersectObjects(this.pickables(), true)[0];
    if (objHit) hits.push({ p: objHit.point.clone(), dist: objHit.distance });
    // floor and walls (planes clipped to the room)
    const tryPlane = (plane: Plane, ok: (p: Vector3) => boolean) => { const p = new Vector3(); if (this.ray.ray.intersectPlane(plane, p) && ok(p)) hits.push({ p, dist: p.distanceTo(this.ray.ray.origin) }); };
    tryPlane(new Plane(new Vector3(0, 1, 0), 0), (p) => Math.abs(p.x) <= W / 2 && Math.abs(p.z) <= D / 2);
    tryPlane(new Plane(new Vector3(0, 0, 1), D / 2), (p) => Math.abs(p.x) <= W / 2 && p.y >= 0 && p.y <= H);
    tryPlane(new Plane(new Vector3(1, 0, 0), W / 2), (p) => Math.abs(p.z) <= D / 2 && p.y >= 0 && p.y <= H);
    hits.sort((a, b) => a.dist - b.dist);
    const p = hits[0]?.p;
    if (!p) return null;
    // snap to the inch grid in all three axes (walls/floor anchored at the room corner)
    return new Vector3(-W / 2 + snapToInch(p.x + W / 2), snapToInch(p.y), -D / 2 + snapToInch(p.z + D / 2));
  }

  private onMove(e: PointerEvent) {
    if (!this.active || this.points.length !== 1) return;
    this.hoverPoint = this.pick(e);
    this.render();
  }

  private onUp(e: PointerEvent) {
    if (!this.active || e.button !== 0) return;
    const p = this.pick(e);
    if (!p) return;
    if (this.points.length >= 2) this.points = [];
    this.points.push(p);
    this.hoverPoint = null;
    this.render();
    if (this.points.length === 2 && this.once) {
      const cb = this.once;
      const d = this.points[0].distanceTo(this.points[1]);
      this.stop();
      cb(d);
    }
  }

  private render() {
    const a = this.points[0], b = this.points[1] ?? this.hoverPoint;
    this.markers[0].visible = !!a; if (a) this.markers[0].position.copy(a);
    this.markers[1].visible = !!this.points[1]; if (this.points[1]) this.markers[1].position.copy(this.points[1]);
    if (a && b) {
      this.line.geometry.dispose();
      this.line.geometry = new BufferGeometry().setAttribute("position", new Float32BufferAttribute([a.x, a.y, a.z, b.x, b.y, b.z], 3));
      this.line.visible = true;
      this.label.hidden = false;
      this.label.textContent = fmt(a.distanceTo(b));
    } else {
      this.line.visible = false;
      this.label.hidden = true;
    }
  }
}

export function fmt(m: number): string {
  const inches = Math.round(m / INCH_M);
  const ft = Math.floor(inches / 12), rem = inches % 12;
  const imperial = ft ? `${ft}' ${rem}"` : `${rem}"`;
  return `${imperial}  ·  ${(m * 100).toFixed(0)} cm`;
}
