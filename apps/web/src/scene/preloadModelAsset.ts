import { useGLTF } from "@react-three/drei";
import { normalizeModelAssetUrl } from "./modelAssetUrl";

export function preloadModelAsset(url: string) {
  useGLTF.preload(normalizeModelAssetUrl(url));
}
