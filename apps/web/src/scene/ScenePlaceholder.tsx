import { ModelAsset } from "./ModelAsset";

/**
 * Lightweight proof that the WebGL renderer is alive. Replace this component
 * with owner-supplied room content; it is not a DreamGrid room implementation.
 */
export function ScenePlaceholder() {
  return (
    <group rotation={[0, -0.4, 0]}>
      <ModelAsset url="/demo-assets/backbone-cube.gltf" />
    </group>
  );
}
