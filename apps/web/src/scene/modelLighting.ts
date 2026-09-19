import type { LightingMode, ModelLighting } from '@dreamgrid/contracts';
import { Color, Group, Material, Mesh, MeshStandardMaterial, Object3D, PointLight, SpotLight, Vector3 } from 'three';

/** Mount beside the GLB under the SAME SceneItem transform group (never inside GLB root). */
export function createModelLights(rig: ModelLighting | undefined, mode: LightingMode): Group {
  const group = new Group();
  group.name = 'dreamgrid-bulb-lights';
  group.visible = mode === 'night';
  for (const source of rig?.sources ?? []) {
    const light = source.type === 'spot'
      ? new SpotLight(source.colorHex, source.intensityCd, source.rangeM,
          source.coneAngleRad, source.penumbra, 2)
      : new PointLight(source.colorHex, source.intensityCd, source.rangeM, 2);
    light.name = source.id;
    light.position.fromArray(source.positionM);
    light.castShadow = false; // Room decides shadow budget; no accidental heavy shadow maps.
    if (light instanceof SpotLight) {
      const target = new Object3D();
      target.position.fromArray(source.positionM).add(
        new Vector3().fromArray(source.direction).normalize(),
      );
      light.target = target;
      group.add(target); // Targets must live in the same transformed coordinate frame.
    }
    group.add(light);
  }
  return group;
}

/** Clone only targeted materials; a shared cached GLB must not make every lamp glow. */
export function cloneModelForLighting(scene: Object3D, rig?: ModelLighting) {
  const instance = scene.clone(true);
  const names = new Set(rig?.sources.flatMap(source => source.emissiveMaterialNames) ?? []);
  const copies = new Map<Material, Material>();
  const copy = (material: Material) => {
    if (!names.has(material.name)) return material;
    if (!copies.has(material)) copies.set(material, material.clone());
    return copies.get(material)!;
  };
  instance.traverse(object => {
    if (!(object instanceof Mesh)) return;
    object.material = Array.isArray(object.material)
      ? object.material.map(copy) : copy(object.material);
  });
  return { instance, dispose: () => copies.forEach(material => material.dispose()) };
}

export function setModelGlow(instance: Object3D, rig: ModelLighting | undefined, mode: LightingMode) {
  const colors = new Map<string, string>();
  for (const source of rig?.sources ?? []) {
    for (const name of source.emissiveMaterialNames) colors.set(name, source.colorHex);
  }
  instance.traverse(object => {
    if (!(object instanceof Mesh)) return;
    const materials: Material[] = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      const color = colors.get(material.name);
      if (!color || !(material instanceof MeshStandardMaterial)) continue;
      material.emissive.copy(new Color(color));
      material.emissiveIntensity = mode === 'night' ? 1.5 : 0;
    }
  });
}
