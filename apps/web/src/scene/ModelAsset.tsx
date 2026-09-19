import { useGLTF } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import type { Object3D } from "three";
import type { LightingMode, ModelLighting } from '@dreamgrid/contracts';
import { normalizeModelAssetUrl } from "./modelAssetUrl";
import { cloneModelForLighting, setModelGlow } from './modelLighting';

export type ModelAssetProps = {
  url: string;
  name?: string;
  onReady?: (model: Object3D) => void;
  lighting?: ModelLighting;
  lightingMode?: LightingMode;
};

/**
 * Read-only GLB loading boundary. Cindy should wrap this component in an
 * interaction-owned group for position/rotation instead of changing the loader.
 */
export function ModelAsset({ url, name = "model-asset", onReady, lighting, lightingMode = 'day' }: ModelAssetProps) {
  const assetUrl = normalizeModelAssetUrl(url);
  const { scene } = useGLTF(assetUrl);
  const model = useMemo(() => cloneModelForLighting(scene, lighting), [scene, lighting]);
  const instance = model.instance;
  useEffect(() => () => model.dispose(), [model]);
  useEffect(() => setModelGlow(instance, lighting, lightingMode), [instance, lighting, lightingMode]);

  useEffect(() => {
    onReady?.(instance);
  }, [instance, onReady]);

  return <primitive object={instance} name={name} />;
}
