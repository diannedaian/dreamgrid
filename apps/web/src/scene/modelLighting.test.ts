import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, SpotLight, Vector3 } from 'three';
import type { ModelLighting } from '@dreamgrid/contracts';
import { cloneModelForLighting, createModelLights, setModelGlow } from './modelLighting';

const lighting: ModelLighting = {
  coordinateSpace: 'model-local', activation: 'night', disclosure: 'Visual defaults',
  sources: [{ id: 'task', type: 'spot', positionM: [.2, 1.2, 0], direction: [1, -1, 0],
    colorHex: '#FFF1D6', intensityCd: 40, rangeM: 5, coneAngleRad: .9, penumbra: .5,
    emissiveMaterialNames: ['DG_bulb'] }],
};

describe('lamp integration boundary', () => {
  it('keeps lights off during day and on at night', () => {
    expect(createModelLights(lighting, 'day').visible).toBe(false);
    expect(createModelLights(lighting, 'night').visible).toBe(true);
    expect(createModelLights(undefined, 'night').children).toHaveLength(0);
  });

  it('transforms bulb positions and spotlight targets with the placed item', () => {
    const item = new Group();
    item.position.set(2, 0, 3);
    item.rotation.y = Math.PI / 2;
    const lights = createModelLights(lighting, 'night');
    item.add(lights);
    item.updateMatrixWorld(true);
    const bulb = lights.getObjectByName('task') as SpotLight;
    const position = bulb.getWorldPosition(new Vector3());
    expect(position.x).toBeCloseTo(2);
    expect(position.y).toBeCloseTo(1.2);
    expect(position.z).toBeCloseTo(2.8);
    const aim = bulb.target.getWorldPosition(new Vector3()).sub(position).normalize();
    expect(aim.x).toBeCloseTo(0);
    expect(aim.y).toBeCloseTo(-Math.SQRT1_2);
    expect(aim.z).toBeCloseTo(-Math.SQRT1_2);
  });

  it('clones emissive materials so instances do not change the shared GLB', () => {
    const shared = new MeshStandardMaterial();
    shared.name = 'DG_bulb';
    const original = new Mesh(new BoxGeometry(), shared);
    const first = cloneModelForLighting(original, lighting);
    const second = cloneModelForLighting(original, lighting);
    setModelGlow(first.instance, lighting, 'night');
    expect(((first.instance as Mesh).material as MeshStandardMaterial).emissiveIntensity).toBe(1.5);
    expect(((second.instance as Mesh).material as MeshStandardMaterial).emissiveIntensity).toBe(1);
    expect(shared.emissive.getHex()).toBe(0);
    setModelGlow(first.instance, lighting, 'day');
    expect(((first.instance as Mesh).material as MeshStandardMaterial).emissiveIntensity).toBe(0);
    first.dispose(); second.dispose(); original.geometry.dispose(); shared.dispose();
  });
});
