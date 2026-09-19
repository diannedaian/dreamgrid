// Lamp registry: objects registered here glow and cast warm light at night.
// Dianne's lamp GLBs plug in via registerLamp(object) once the catalog lands.
import { Box3, Color, Mesh, MeshStandardMaterial, Object3D, PointLight, Vector3 } from "three";

export type LightingMode = "day" | "night";

export type LampOptions = {
  /** Where the bulb sits relative to the object's pivot (bottom-center), in meters. Defaults near the top of its bounds. */
  bulbOffsetM?: [x: number, y: number, z: number];
  color?: string;
  /** Night intensity of the point light. */
  intensity?: number;
  /** Reach of the light in meters. */
  distanceM?: number;
};

type Entry = { object: Object3D; light: PointLight; glow: MeshStandardMaterial[]; intensity: number };

export class LampRegistry {
  private entries: Entry[] = [];
  private mode: LightingMode = "day";

  registerLamp(object: Object3D, opts: LampOptions = {}): void {
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

    const entry = { object, light, glow, intensity: opts.intensity ?? 1.4 };
    this.entries.push(entry);
    this.apply(entry);
  }

  unregister(object: Object3D): void {
    const i = this.entries.findIndex((e) => e.object === object);
    if (i < 0) return;
    const [e] = this.entries.splice(i, 1);
    e.object.remove(e.light);
    for (const mat of e.glow) mat.emissiveIntensity = 0;
  }

  setMode(mode: LightingMode): void {
    this.mode = mode;
    for (const e of this.entries) this.apply(e);
  }

  private apply(e: Entry) {
    const on = this.mode === "night";
    e.light.intensity = on ? e.intensity : 0;
    for (const mat of e.glow) mat.emissiveIntensity = on ? 0.8 : 0;
  }
}

function defaultBulbOffset(object: Object3D): [number, number, number] {
  const box = new Box3().setFromObject(object);
  const size = new Vector3();
  box.getSize(size);
  return [0, Math.max(0.05, size.y * 0.85), 0];
}
