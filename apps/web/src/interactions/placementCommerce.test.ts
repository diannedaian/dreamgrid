import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Group, PerspectiveCamera, Scene } from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ModelAsset, RoomSpec } from "@contracts";
import { Catalog } from "../catalog/catalog";
import { testProduct } from "../commerce/testFixtures";
import { PlacementController } from "./placement";
import { LampRegistry } from "./lamps";
import { loadModel } from "./models";

vi.mock("./models", () => ({ loadModel: vi.fn(async () => new Group()) }));
const room: RoomSpec = { widthM: 4, depthM: 4, heightM: 3, gridSizeM: .0254, lightingMode: "day" };
const asset: ModelAsset = { id: "asset-ready", productId: "original", glbUrl: "fixture:box", dimensionsM: [.5, .5, .5], pivot: "bottom-center", forwardAxis: "+Z", generationMethod: "public-preset", status: "ready", disclosure: "Test fixture" };
const original = testProduct("original", { priceUsd: 100, modelAssetId: asset.id });
const cheaper = testProduct("cheaper", { priceUsd: 50, modelAssetId: "asset-cheaper" });
const replacement = { ...asset, id: "asset-cheaper", productId: cheaper.id };

beforeEach(() => {
  vi.stubGlobal("document", { getElementById: () => null });
  vi.stubGlobal("window", { addEventListener: vi.fn() });
  vi.mocked(loadModel).mockReset().mockImplementation(async () => new Group());
});
afterEach(() => vi.unstubAllGlobals());

function controller(catalog = new Catalog()) {
  const changed = vi.fn();
  const placement = new PlacementController(new Scene(), new PerspectiveCamera(), { addEventListener: vi.fn(), style: {} } as unknown as HTMLCanvasElement, room, {} as OrbitControls, catalog, new LampRegistry(), changed);
  return { placement, changed };
}

describe("wall-hung mirrors and art", () => {
  const mirror = testProduct("mirror", { title: "Green velvet mirror", category: "decor", dimensionsM: [.508, .7112, .0356] });
  const floorMirror = testProduct("floor-mirror", { title: "Leaning floor mirror", category: "decor", dimensionsM: [.6, 1.7, .05] });

  it("hangs on the nearer wall at eye level, facing into the room, and can move up and down", async () => {
    const { placement } = controller();
    const item = await placement.add(mirror, undefined, [0, 0, 0]);
    expect(item.rotationYDeg).toBe(0);
    expect(item.positionM[2]).toBeCloseTo(-2 + .0356 / 2, 6); // flat on the back wall
    expect(item.positionM[1]).toBeCloseTo(Math.round((1.5 - .7112 / 2) / .0254) * .0254, 6);
    expect(placement.canRaise(item.id)).toBe(true);
    expect(placement.isWallMounted(item.id)).toBe(true);
    placement.raise(item.id, -12);
    expect(item.positionM[1]).toBeCloseTo(Math.round((1.5 - .7112 / 2) / .0254) * .0254 - 12 * .0254, 6);
    // Dragged toward the left wall it flips to face +X and sits flush there instead.
    placement.moveTo(item.id, -1.9, .5);
    expect(item.rotationYDeg).toBe(90);
    expect(item.positionM[0]).toBeCloseTo(-2 + .0356 / 2, 6);
    expect(item.positionM[2]).toBeCloseTo(.5, 1);
    // Rotate hops it back to the other wall rather than turning it away from the room.
    placement.rotate(item.id);
    expect(item.rotationYDeg).toBe(0);
    expect(item.positionM[2]).toBeCloseTo(-2 + .0356 / 2, 6);
  });

  it("keeps a saved hanging height on reload and leaves floor mirrors on the floor", async () => {
    const catalog = new Catalog();
    catalog.add([mirror]);
    const { placement } = controller(catalog);
    await placement.loadItems([{ id: "saved", productId: mirror.id, modelAssetId: "", positionM: [.3, 1.2192, -1.98], rotationYDeg: 0 }]);
    expect(placement.items[0].positionM[1]).toBeCloseTo(1.2192, 6); // 48 in, unchanged
    const other = await placement.add(floorMirror, undefined, [0, 0, 0]);
    expect(placement.isWallMounted(other.id)).toBe(false);
    expect(other.positionM[1]).toBe(0);
  });
});

describe("floor-only rugs and carpets", () => {
  const table = testProduct("table", { title: "Desk", category: "desk", dimensionsM: [1.27, .762, 1.27] });
  const rugs = [
    testProduct("cloud", { title: "Cloud Checker rug", dimensionsM: [.762, .05, 1.1684] }),
    testProduct("halo", { title: "Aqua Halo rug", dimensionsM: [.9144, .05, .9144] }),
    testProduct("carpet", { title: "Thick shag carpet", dimensionsM: [1.016, .1, 1.524] }),
    testProduct("tagged", { title: "Cloud Checker", styleTags: ["area rugs"], dimensionsM: [1.016, .1, 1.524] }),
    testProduct("mat", { title: "Floor mat", dimensionsM: [.508, .02, .8128] }),
  ];

  it.each(rugs)("keeps $title on the floor on drop, drag, raise and rotation", async rug => {
    const { placement } = controller();
    await placement.add(table, undefined, [0, 0, 0]);
    const item = await placement.add(rug, undefined, [0, 0, 0]);
    expect(item.positionM[1]).toBe(0);
    expect(placement.canRaise(item.id)).toBe(false);
    placement.moveTo(item.id, .1, .1, 1, true);
    expect(item.positionM[1]).toBe(0);
    placement.moveTo(item.id, -2, -2, 1);
    expect(placement.isAgainstWall(item.id)).toBe(true);
    expect(item.positionM[1]).toBe(0);
    placement.raise(item.id, 12);
    placement.rotate(item.id);
    expect(item.positionM[1]).toBe(0);
    expect(placement.objects().find(o => o.userData.itemId === item.id)?.position.y).toBe(0);
    expect(placement.overlaps(item.id)).toBe(false);
  });

  it("grounds an elevated rug restored from an old saved room", async () => {
    const catalog = new Catalog();
    catalog.add([rugs[0]]);
    const { placement } = controller(catalog);
    await placement.loadItems([{ id: "saved-rug", productId: rugs[0].id, modelAssetId: "saved-asset", positionM: [-1.5, .762, -1.5], rotationYDeg: 90 }]);
    expect(placement.items[0].positionM[1]).toBe(0);
    expect(placement.objects()[0].position.y).toBe(0);
  });

  it.each([
    testProduct("plant", { title: "Small plant" }),
    testProduct("lamp", { title: "Table lamp", category: "lamp" }),
    testProduct("tray", { title: "Decorative tray", dimensionsM: [.3, .02, .2] }),
  ])("still snaps $title onto furniture surfaces", async product => {
    const { placement } = controller();
    await placement.add(table, undefined, [0, 0, 0]);
    const item = await placement.add(product, undefined, [0, 0, 0]);
    expect(item.positionM[1]).toBeCloseTo(.762);
    expect(placement.canRaise(item.id)).toBe(true);
    placement.moveTo(item.id, 1.5, 1.5, undefined, true);
    expect(item.positionM[1]).toBe(0);
  });

  it("grounds a rug swapped into a previously raised decor placement", async () => {
    const { placement } = controller();
    await placement.add(original, asset, [0, .762, 0], 90, "swap-me");
    await placement.replace("swap-me", rugs[0], { ...asset, productId: rugs[0].id });
    expect(placement.items[0].positionM[1]).toBe(0);
  });
});

describe("atomic commerce replacement", () => {
  it("preserves IDs, position, rotation and overlap override across swap and undo", async () => {
    const { placement, changed } = controller();
    await placement.add(original, asset, [0, .5, 0], 90, "item-1");
    const before = structuredClone(placement.items[0]);
    const internal = placement as unknown as { selected: string };
    internal.selected = "item-1";
    placement.toggleIgnoreSelected();
    changed.mockClear();
    await placement.replace("item-1", cheaper, replacement);
    expect(placement.items).toEqual([{ ...before, productId: cheaper.id, modelAssetId: replacement.id }]);
    expect(placement.ignoredIds).toEqual(["item-1"]);
    expect(changed).toHaveBeenCalledTimes(1);
    await placement.replace("item-1", original, asset);
    expect(placement.items).toEqual([before]);
  });

  it("keeps the old mesh and state if a generated model fails to load", async () => {
    const { placement, changed } = controller();
    await placement.add(original, asset, [0, 0, 0], 180, "item-1");
    const before = structuredClone(placement.items), objects = placement.objects();
    changed.mockClear();
    vi.mocked(loadModel).mockRejectedValueOnce(new Error("GLB unavailable"));
    await expect(placement.replace("item-1", cheaper, replacement)).rejects.toThrow("GLB unavailable");
    expect(placement.items).toEqual(before);
    expect(placement.objects()).toEqual(objects);
    expect(changed).not.toHaveBeenCalled();
  });

  it("does not replace a removed item or turn an ungenerated product into a box", async () => {
    const { placement } = controller();
    await placement.add(original, asset, [0, 0, 0], 0, "item-1");
    await expect(placement.replace("item-1", cheaper, undefined)).rejects.toThrow("Generate");
    let finish!: (group: Group) => void;
    vi.mocked(loadModel).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = placement.replace("item-1", cheaper, replacement);
    placement.remove("item-1");
    finish(new Group());
    await expect(pending).rejects.toThrow("changed");
    expect(placement.items).toEqual([]);
  });
});
