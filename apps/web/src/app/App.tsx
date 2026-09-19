import { lazy, Suspense } from "react";
import { ApiStatus } from "./components/ApiStatus";
import "./App.css";

const SceneCanvas = lazy(async () => {
  const sceneModule = await import("../scene/SceneCanvas");
  return { default: sceneModule.SceneCanvas };
});

const ownership = [
  {
    name: "Dianne",
    area: "Room + model generation",
    detail: "Room geometry, normalized GLB assets, and generation pipeline.",
  },
  {
    name: "Cindy",
    area: "Catalog + interaction",
    detail: "Shopping flow, selection, dragging, snapping, and rotation.",
  },
  {
    name: "Linda",
    area: "Budget + commerce",
    detail: "Totals, alternatives, approval, and Visa sandbox flow.",
  },
] as const;

export function App() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="DreamGrid home">
          <span className="brand-mark" aria-hidden="true">
            D
          </span>
          <span>
            <strong>DreamGrid</strong>
            <small>Design before you buy</small>
          </span>
        </a>
        <ApiStatus />
      </header>

      <main className="workspace">
        <section className="scene-card" aria-labelledby="scene-title">
          <div className="scene-heading">
            <div>
              <p className="eyebrow">Shared 3D workspace</p>
              <h1 id="scene-title">The foundation is ready.</h1>
            </div>
            <span className="renderer-badge">WebGL preview</span>
          </div>

          <div className="scene-frame">
            <Suspense
              fallback={
                <div className="scene-canvas-loading">Preparing 3D renderer…</div>
              }
            >
              <SceneCanvas />
            </Suspense>
            <div className="scene-caption">
              <strong>Scene boundary connected</strong>
              <span>Room and interaction features plug in here.</span>
            </div>
          </div>
        </section>

        <aside className="handoff-card" aria-labelledby="handoff-title">
          <p className="eyebrow">Team handoff map</p>
          <h2 id="handoff-title">Three lanes, one shared scene</h2>
          <p className="handoff-intro">
            Each owner can build against stable seams without waiting for another
            subsystem.
          </p>

          <ol className="ownership-list">
            {ownership.map((owner, index) => (
              <li key={owner.name}>
                <span className="owner-number">{index + 1}</span>
                <div>
                  <strong>{owner.name}</strong>
                  <span>{owner.area}</span>
                  <p>{owner.detail}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="foundation-note">
            <span aria-hidden="true">✓</span>
            <p>
              <strong>Backbone only</strong>
              No product behavior is implemented in this shell.
            </p>
          </div>
        </aside>
      </main>

      <footer>
        <span>HackMIT 2026</span>
        <span>Built for a reliable shared demo</span>
      </footer>
    </div>
  );
}
