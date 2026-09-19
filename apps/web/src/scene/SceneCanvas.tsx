import { Canvas } from "@react-three/fiber";
import { Suspense, type ReactNode } from "react";
import { ScenePlaceholder } from "./ScenePlaceholder";
import { SceneLighting } from "./SceneLighting";
import { SceneErrorBoundary } from "./SceneErrorBoundary";

export type SceneCanvasProps = {
  children?: ReactNode;
  className?: string;
  lighting?: ReactNode;
};

/**
 * Shared renderer boundary. Dianne supplies room/lighting children here; Cindy
 * can wrap model assets with interaction groups without owning the renderer.
 */
export function SceneCanvas({ children, className, lighting }: SceneCanvasProps) {
  return (
    <div
      className={["scene-canvas", className].filter(Boolean).join(" ")}
      aria-label="DreamGrid 3D scene"
    >
      <SceneErrorBoundary>
        <Canvas
          camera={{ position: [4, 3, 6], fov: 45, near: 0.1, far: 100 }}
          dpr={[1, 1.5]}
          fallback={
            <div className="scene-canvas__fallback" role="status">
              WebGL is unavailable in this browser.
            </div>
          }
          gl={{ antialias: true, alpha: false }}
          onCreated={({ camera }) => camera.lookAt(0, 0.6, 0)}
        >
          <color attach="background" args={["#eeeafd"]} />
          {lighting === undefined ? <SceneLighting /> : lighting}
          <Suspense fallback={null}>{children ?? <ScenePlaceholder />}</Suspense>
        </Canvas>
      </SceneErrorBoundary>
    </div>
  );
}
