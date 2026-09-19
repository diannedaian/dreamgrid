// Offscreen thumbnails: render each catalog model once into a small canvas and cache the PNG.
import { Box3, Color, DirectionalLight, HemisphereLight, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from "three";
import type { CatalogEntry } from "./catalog";
import { loadModel } from "../interactions/models";

export class ThumbnailRenderer {
  private renderer: WebGLRenderer | null = null;
  private cache = new Map<string, Promise<string | null>>();

  /** PNG data URL of the model, or null if rendering isn't possible. */
  render(entry: CatalogEntry, size = 128): Promise<string | null> {
    const key = `${entry.asset?.id ?? entry.product.id}@${size}`;
    if (!this.cache.has(key)) this.cache.set(key, this.draw(entry, size).catch(() => null));
    return this.cache.get(key)!;
  }

  private async draw(entry: CatalogEntry, size: number): Promise<string> {
    if (!this.renderer) {
      this.renderer = new WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
      this.renderer.setPixelRatio(1);
    }
    const r = this.renderer;
    r.setSize(size, size, false);
    r.setClearColor(0x000000, 0);

    const scene = new Scene();
    const model = await loadModel(entry.product, entry.asset);
    scene.add(model);
    scene.add(new HemisphereLight(new Color("#fff7ea"), new Color("#b9a27e"), 1.6));
    const key = new DirectionalLight(new Color("#ffe9d0"), 2.2);
    key.position.set(2, 3, 2.5);
    scene.add(key);

    const box = new Box3().setFromObject(model);
    const center = new Vector3(), sz = new Vector3();
    box.getCenter(center);
    box.getSize(sz);
    const radius = Math.max(sz.x, sz.y, sz.z) * 0.62 || 0.5;
    const camera = new PerspectiveCamera(30, 1, 0.01, 100);
    const dist = radius / Math.sin((camera.fov * Math.PI) / 360);
    camera.position.copy(center).add(new Vector3(0.9, 0.7, 1.1).normalize().multiplyScalar(dist));
    camera.lookAt(center);
    r.render(scene, camera);
    return r.domElement.toDataURL("image/png");
  }
}
