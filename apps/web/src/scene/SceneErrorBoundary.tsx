import { Component, type ReactNode } from "react";

/** Keep the rest of the shell usable if WebGL or an asset fails. */
export class SceneErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="scene-canvas__fallback" role="alert">
          The 3D preview could not load. Check the model URL or reload the page.
        </div>
      );
    }
    return this.props.children;
  }
}
