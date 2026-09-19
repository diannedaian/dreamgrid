import { afterEach, describe, expect, it, vi } from "vitest";
import { Catalog } from "./catalog";
import catalogData from "../../public/demo-assets/catalog.json";

afterEach(() => vi.unstubAllGlobals());

describe("curated demo catalog", () => {
  it("hides the five retired placeholders but keeps old plan IDs resolvable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => catalogData })));
    const catalog = await Catalog.load();
    const visible = catalog.entries().map((e) => e.product.id);
    for (const id of ["p-bed-twin", "p-desk", "p-chair", "p-shelf", "p-rug"]) {
      expect(visible).not.toContain(id);
      expect(catalog.get(id)).toBeDefined();
    }
    for (const id of ["college-bed", "college-desk", "college-chair", "cloud-checker-rug", "aqua-halo-rug"]) {
      expect(visible).toContain(id);
    }
    expect(catalog.grouped().some((g) => g.key === "shelf")).toBe(false);
  });

  it("adds the saved two-bulb lamp without replacing the fixture lamps", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => catalogData })));
    const catalog = await Catalog.load();
    const lamps = catalog.grouped().find((group) => group.key === "lamp")!;
    const entry = lamps.entries.find((item) => item.product.id === "torchiere-task-lamp")!;
    expect(entry.product.priceUsd).toBe(20);
    expect(entry.product.dimensionsM).toEqual([0.52, 1.8161, 0.2413]);
    expect(entry.asset?.glbUrl).toBe("/demo-assets/torchiere-task-lamp.glb");
    expect(entry.asset?.status).toBe("ready");
    expect(entry.asset?.disclosure).toContain("user-approved estimates");
    expect(lamps.entries.some((item) => item.product.id === "p-floor-lamp")).toBe(true);
  });

  it("includes the dimension-verified drawer chest with an explicitly unknown price", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => catalogData })));
    const catalog = await Catalog.load();
    const entry = catalog.entries().find((item) => item.product.id === "campus-drawer-chest")!;
    expect(entry.product.title).toBe("Campus 4-drawer chest");
    expect(entry.product.sourceUrl).toBe("https://dcifurn.com/campus-4-drawer-chest/");
    expect(entry.product.dimensionsM).toEqual([0.762, 0.9652, 0.4572]);
    expect(entry.product.styleTags).toContain("price-not-provided");
    expect(entry.asset?.dimensionsM).toEqual(entry.product.dimensionsM);
    expect(entry.asset?.glbUrl).toBe("/demo-assets/campus-drawer-chest.glb");
    expect(entry.asset?.status).toBe("ready");
    expect(entry.asset?.disclosure).toContain("not an official manufacturer mesh");
  });

  it("replaces the mini-fridge placeholder using its existing saved-plan IDs", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => catalogData })));
    const catalog = await Catalog.load();
    const entry = catalog.get("p-mini-fridge")!;
    expect(entry.product.title).toBe("Whirlpool mini fridge");
    expect(entry.product.sourceUrl).toContain("lowes.com");
    expect(entry.product.dimensionsM).toEqual([0.504952, 0.835914, 0.559054]);
    expect(entry.asset?.id).toBe("m-mini-fridge");
    expect(entry.asset?.glbUrl).toBe("/demo-assets/mini-fridge.glb");
    expect(catalog.entries().filter((e) => e.product.id === "p-mini-fridge")).toHaveLength(1);
  });

  it("loads both ready rugs into Decor alongside existing assets", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => catalogData })));
    const catalog = await Catalog.load();
    const decor = catalog.grouped().find((group) => group.key === "decor")!;
    for (const [id, price, dims] of [
      ["cloud-checker-rug", 58.99, [0.762, 0.05, 1.1684]],
      ["aqua-halo-rug", 46.99, [0.9144, 0.05, 0.9144]],
    ] as const) {
      const entry = decor.entries.find((item) => item.product.id === id)!;
      expect(entry.asset?.status).toBe("ready");
      expect(entry.asset?.glbUrl).toBe(`/demo-assets/${id}.glb`);
      expect(entry.product.dimensionsM).toEqual(dims);
      expect(entry.asset?.dimensionsM).toEqual(dims);
      expect(entry.product.priceUsd).toBe(price);
      expect(entry.product.sourceUrl).toContain("wayfair.com");
      expect(entry.asset?.disclosure).toContain("not a live price check");
    }
    expect(catalog.get("college-bed")).toBeDefined();
    expect(catalog.get("monstera-plant")).toBeDefined();
    expect(catalog.get("p-floor-lamp")).toBeDefined();
  });
});
