import { useGLTF } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import type { Object3D } from "three";
import { normalizeModelAssetUrl } from "./modelAssetUrl";

export type ModelAssetProps = {
  url: string;
  name?: string;
  onReady?: (model: Object3D) => void;
};

/**
 * Read-only GLB loading boundary. Cindy should wrap this component in an
 * interaction-owned group for position/rotation instead of changing the loader.
 */
export function ModelAsset({ url, name = "model-asset", onReady }: ModelAssetProps) {
  const assetUrl = normalizeModelAssetUrl(url);
  const { scene } = useGLTF(assetUrl);
  const instance = useMemo(() => scene.clone(true), [scene]);

  useEffect(() => {
    onReady?.(instance);
  }, [instance, onReady]);

  return <primitive object={instance} name={name} />;
}
