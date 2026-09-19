import { useEffect, useMemo } from 'react';
import type { LightingMode, ModelLighting } from '@dreamgrid/contracts';
import { Light } from 'three';
import { createModelLights } from './modelLighting';

/** Sibling of ModelAsset inside Cindy's positioned/rotated SceneItem group. */
export function ModelLights({ lighting, mode }: { lighting?: ModelLighting; mode: LightingMode }) {
  const group = useMemo(() => createModelLights(lighting, mode), [lighting, mode]);
  useEffect(() => () => group.traverse(object => {
    if (object instanceof Light) object.dispose();
  }), [group]);
  return <primitive object={group} />;
}
