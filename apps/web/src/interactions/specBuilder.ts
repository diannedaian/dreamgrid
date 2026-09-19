// Constrained FurnitureSpec interpreter (packages/contracts/schemas/furniture-spec.schema.json):
// boxes, rounded boxes, cylinders and lampshades assembled into a Group. Same vocabulary as
// Dianne's Blender builder, so a spec can later be exported to a real GLB without changes.
import { BoxGeometry, Color, CylinderGeometry, DoubleSide, Group, MathUtils, Mesh, MeshStandardMaterial } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

export type FurnitureSpec = {
  schemaVersion?: string;
  name: string;
  category: string;
  dimensionsM: [number, number, number];
  materials: Array<{ id: string; name: string; baseColorHex: string; roughness: number; metallic: number }>;
  parts: Array<{
    id: string; primitive: "box" | "rounded-box" | "cylinder" | "shade"; role: string;
    dimensionsM: [number, number, number]; positionM: [number, number, number]; rotationDeg: [number, number, number];
    materialId: string; cornerRadiusM?: number | null; repeat?: { count: number; offsetM: [number, number, number] } | null;
  }>;
};

/**
 * Deterministic fixes for common model mistakes: a "top" part is lifted so its upper face sits at
 * the item's height, and "leg"/"support" parts are trimmed to end under the lowest top.
 */
export function tidySpec(spec: FurnitureSpec): FurnitureSpec {
  const H = spec.dimensionsM[1];
  const parts = spec.parts.map((p) => ({ ...p, dimensionsM: [...p.dimensionsM] as [number, number, number], positionM: [...p.positionM] as [number, number, number] }));
  const tops = parts.filter((p) => p.role === "top");
  const legs = parts.filter((p) => p.role === "leg" || p.role === "support");
  if (tops.length && legs.length) {
    for (const t of tops) if (t.positionM[1] + t.dimensionsM[1] / 2 < H * 0.85) t.positionM[1] = H - t.dimensionsM[1] / 2;
    const underside = Math.min(...tops.map((t) => t.positionM[1] - t.dimensionsM[1] / 2));
    for (const l of legs) {
      const legTop = l.positionM[1] + l.dimensionsM[1] / 2;
      if (legTop > underside + 1e-3 && l.rotationDeg.every((r) => Math.abs(r) < 1)) {
        const bottom = Math.max(0, l.positionM[1] - l.dimensionsM[1] / 2);
        l.dimensionsM[1] = Math.max(0.01, underside - bottom);
        l.positionM[1] = bottom + l.dimensionsM[1] / 2;
      }
    }
  }
  return { ...spec, parts };
}

export function buildFromSpec(input: FurnitureSpec): Group {
  const spec = tidySpec(input);
  const g = new Group();
  g.name = spec.name;
  const mats = new Map<string, MeshStandardMaterial>();
  for (const m of spec.materials) {
    const color = /^#[0-9a-f]{6}$/i.test(m.baseColorHex) ? m.baseColorHex : "#cccccc";
    mats.set(m.id, new MeshStandardMaterial({ color: new Color(color), roughness: clamp(m.roughness, 0, 1), metalness: clamp(m.metallic, 0, 1) }));
  }
  const fallback = new MeshStandardMaterial({ color: new Color("#cccccc"), roughness: 0.8 });
  for (const p of spec.parts.slice(0, 100)) {
    const [w, h, d] = p.dimensionsM.map((v) => Math.max(0.002, Math.min(20, Number(v) || 0.01))) as [number, number, number];
    const count = p.repeat ? Math.max(2, Math.min(16, Math.round(p.repeat.count))) : 1;
    for (let i = 0; i < count; i++) {
      const mesh = new Mesh(geometry(p.primitive, w, h, d, p.cornerRadiusM ?? 0), mats.get(p.materialId) ?? fallback);
      const off = p.repeat ? p.repeat.offsetM.map((v) => v * i) : [0, 0, 0];
      mesh.position.set(p.positionM[0] + off[0], p.positionM[1] + off[1], p.positionM[2] + off[2]);
      mesh.rotation.set(MathUtils.degToRad(p.rotationDeg[0]), MathUtils.degToRad(p.rotationDeg[1]), MathUtils.degToRad(p.rotationDeg[2]));
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.name = count > 1 ? `${p.id}-${i}` : p.id;
      g.add(mesh);
    }
  }
  return g;
}

function geometry(kind: FurnitureSpec["parts"][number]["primitive"], w: number, h: number, d: number, radius: number) {
  switch (kind) {
    case "rounded-box": return new RoundedBoxGeometry(w, h, d, 3, Math.min(radius || Math.min(w, h, d) * 0.15, Math.min(w, h, d) / 2));
    case "cylinder": return new CylinderGeometry(w / 2, w / 2, h, 32);
    case "shade": { const geo = new CylinderGeometry(w * 0.32, w / 2, h, 32, 1, true); geo.computeVertexNormals(); return geo; }
    default: return new BoxGeometry(w, h, d);
  }
}

/** Light validation; throws with a readable message. */
export function validateSpec(spec: unknown): FurnitureSpec {
  const s = spec as FurnitureSpec;
  if (!s || !Array.isArray(s.parts) || !s.parts.length) throw new Error("Spec has no parts");
  if (!Array.isArray(s.materials) || !s.materials.length) throw new Error("Spec has no materials");
  if (!Array.isArray(s.dimensionsM) || s.dimensionsM.length !== 3) throw new Error("Spec has no dimensions");
  return s;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, Number(v) || 0));

// shade material should render both sides
export function twoSided(g: Group) { g.traverse((o) => { const m = o as Mesh; if (m.isMesh && m.name.startsWith("shade")) (m.material as MeshStandardMaterial).side = DoubleSide; }); return g; }
