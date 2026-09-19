// Lamp registry: objects registered here glow and cast warm light at night.
// Generated GLBs can supply multiple bulb positions; fixtures keep their default light.
import { Box3, Color, Mesh, MeshStandardMaterial, Object3D, PointLight, SpotLight, Vector3 } from "three";

export type LightingMode = "day" | "night";

// The room uses artistic exposure/bloom and low-intensity fixture lights, not a
// photometric renderer. Keep source candela metadata intact but soften it here.
const GENERATED_LIGHT_PREVIEW_SCALE = 0.05;

export type LampOptions = {
  /** Where the bulb sits relative to the object's pivot (bottom-center), in meters. Defaults near the top of its bounds. */
  bulbOffsetM?: [x: number, y: number, z: number];
  color?: string;
  /** Night intensity of the point light. */
  intensity?: number;
  /** Reach of the light in meters. */
  distanceM?: number;
};

type Emitter = { light: PointLight | SpotLight; intensity: number; target?: Object3D };
type Entry = { object: Object3D; emitters: Emitter[]; glow: Set<MeshStandardMaterial> };

// Narrow adapter for the existing GLB extras; no catalog/API contract changes.
type Source = {
  id: string; type: "point" | "spot"; positionM: [number, number, number];
  direction?: [number, number, number]; colorHex: string; intensityCd: number;
  rangeM: number; coneAngleRad?: number; penumbra?: number;
  emissiveMaterialNames: string[];
};

export class LampRegistry {
  private entries: Entry[] = [];
  private mode: LightingMode = "day";

  registerLamp(object: Object3D, opts: LampOptions = {}): void {
    this.unregister(object); // re-registering must not leak lights
    let rig: { space: Object3D; sources: Source[] } | undefined;
    object.traverse((node) => {
      if (rig) return;
      const sources = readSources(node.userData.dreamgridLighting);
      if (sources.length) rig = { space: node, sources };
    });
    if (rig) {
      const { space, sources } = rig;
      const entry: Entry = { object, emitters: [], glow: new Set() };
      for (const source of sources) {
        const color = new Color(source.colorHex);
        const light = source.type === "spot"
          ? new SpotLight(color, 0, source.rangeM, source.coneAngleRad ?? Math.PI / 4, source.penumbra ?? 0.5, 2)
          : new PointLight(color, 0, source.rangeM, 2);
        light.name = `dreamgrid:${source.id}`;
        light.position.set(...source.positionM);
        space.add(light);
        let target: Object3D | undefined;
        if (light instanceof SpotLight) {
          target = new Object3D();
          target.position.copy(light.position).add(new Vector3(...source.direction!).normalize());
          space.add(target);
          light.target = target;
        }
        entry.emitters.push({ light, target, intensity: opts.intensity ?? source.intensityCd * GENERATED_LIGHT_PREVIEW_SCALE });
        object.traverse((node) => {
          if (!(node instanceof Mesh)) return;
          const mats = Array.isArray(node.material) ? node.material : [node.material];
          for (const mat of mats) {
            if (mat instanceof MeshStandardMaterial && source.emissiveMaterialNames.includes(mat.name)) {
              mat.emissive.copy(color);
              entry.glow.add(mat);
            }
          }
        });
      }
      this.entries.push(entry);
      this.apply(entry);
      return;
    }

    const color = new Color(opts.color ?? "#ffb86c");
    const light = new PointLight(color, 0, opts.distanceM ?? 3.0, 2);
    light.position.set(...(opts.bulbOffsetM ?? defaultBulbOffset(object)));
    object.add(light);

    // Meshes named or tagged as the glowing part (bulb, shade) go emissive at night.
    const glow: MeshStandardMaterial[] = [];
    object.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      const tagged = m.userData.glow || /bulb|shade|glow|light/i.test(m.name);
      if (!tagged) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) if ((mat as MeshStandardMaterial).isMeshStandardMaterial) glow.push(mat as MeshStandardMaterial);
    });
    for (const mat of glow) mat.emissive = color.clone();

    const entry: Entry = { object, emitters: [{ light, intensity: opts.intensity ?? 1.4 }], glow: new Set(glow) };
    this.entries.push(entry);
    this.apply(entry);
  }

  unregister(object: Object3D): void {
    const i = this.entries.findIndex((e) => e.object === object);
    if (i < 0) return;
    const [e] = this.entries.splice(i, 1);
    for (const { light, target } of e.emitters) {
      light.removeFromParent();
      light.dispose();
      target?.removeFromParent();
    }
    for (const mat of e.glow) mat.emissiveIntensity = 0;
  }

  setMode(mode: LightingMode): void {
    this.mode = mode;
    for (const e of this.entries) this.apply(e);
  }

  private apply(e: Entry) {
    const on = this.mode === "night";
    for (const { light, intensity } of e.emitters) light.intensity = on ? intensity : 0;
    for (const mat of e.glow) mat.emissiveIntensity = on ? 0.8 : 0;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function vector(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every((v) => typeof v === "number" && Number.isFinite(v));
}
function bounded(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}
function readSources(value: unknown): Source[] {
  if (!record(value) || value.coordinateSpace !== "model-local" || value.activation !== "night" || !Array.isArray(value.sources)) return [];
  if (!value.sources.length || value.sources.length > 8) return [];
  const sources: Source[] = [];
  for (const s of value.sources) {
    if (!record(s) || typeof s.id !== "string" || !["point", "spot"].includes(String(s.type)) || !vector(s.positionM)
      || typeof s.colorHex !== "string" || !/^#[0-9a-f]{6}$/i.test(s.colorHex)
      || !bounded(s.intensityCd, 0, 10000) || !bounded(s.rangeM, 0.01, 100)
      || !Array.isArray(s.emissiveMaterialNames) || !s.emissiveMaterialNames.every((n) => typeof n === "string")) return [];
    if (s.type === "spot" && (!vector(s.direction) || Math.hypot(...s.direction) < 0.0001
      || (s.coneAngleRad !== undefined && !bounded(s.coneAngleRad, 0.001, Math.PI / 2))
      || (s.penumbra !== undefined && !bounded(s.penumbra, 0, 1)))) return [];
    sources.push(s as Source);
  }
  return sources;
}

function defaultBulbOffset(object: Object3D): [number, number, number] {
  const box = new Box3().setFromObject(object);
  const size = new Vector3();
  box.getSize(size);
  return [0, Math.max(0.05, size.y * 0.85), 0];
}
