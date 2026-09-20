import { afterEach, describe, expect, it, vi } from "vitest";
import { Catalog } from "./catalog";
import catalogData from "../../public/demo-assets/catalog.json";
import { saveGeneratedEntry } from "./generatedCatalog";
import { saveProduct } from "../commerce/savedProducts";
import { testProduct } from "../commerce/testFixtures";

afterEach(() => vi.unstubAllGlobals());

describe("curated demo catalog", () => {
  it("adds the styled chenille queen bed without replacing the college bed or inventing a price", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => catalogData })));
    const catalog = await Catalog.load();
    const entry = catalog.get("chenille-queen-bed")!;
    expect(entry.product.category).toBe("bed");
    expect(entry.product.priceUsd).toBe(0);
    expect(entry.product.styleTags).toContain("price-not-provided");
    expect(entry.product.sourceUrl).toContain("44304387/product.html");
    expect(entry.product.dimensionsM).toEqual([1.77497673, 0.889, 2.2352]);
    expect(entry.asset?.dimensionsM).toEqual(entry.product.dimensionsM);
    expect(entry.asset?.glbUrl).toBe("/demo-assets/chenille-queen-bed.glb");
    expect(entry.asset?.disclosure).toContain("bedding");
    expect(catalog.grouped().find(g => g.key === "bed")?.entries.map(e => e.product.id)).toEqual(expect.arrayContaining(["college-bed", "chenille-queen-bed"]));
  });
  it("adds the velvet mirror and olive rug to Decor and the bouclé lounge chair to Chairs, all unpriced", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => catalogData })));
    const catalog = await Catalog.load();
    const expected = [
      ["green-velvet-mirror", "decor", "/demo-assets/green-velvet-mirror.glb", [0.508, 0.7112, 0.03556]],
      ["prisco-olive-rug", "decor", "/demo-assets/prisco-olive-rug.glb", [0.762, 0.006, 1.1684]],
      ["green-boucle-lounge-chair", "chair", "/demo-assets/green-boucle-lounge-chair.glb", [1.249934, 0.690118, 1.249934]],
    ] as const;
    for (const [id, category, glb, dims] of expected) {
      const entry = catalog.get(id)!;
      expect(entry.product.category).toBe(category);
      expect(entry.product.styleTags).toContain("price-not-provided");
      expect(entry.asset?.status).toBe("ready");
      expect(entry.asset?.glbUrl).toBe(glb);
      expect(entry.asset?.dimensionsM).toEqual([...dims]);
      expect(entry.product.dimensionsM).toEqual([...dims]);
    }
    expect(catalog.get("green-velvet-mirror")!.product.styleTags).toContain("wall-mounted");
    expect(catalog.get("prisco-olive-rug")!.product.styleTags).toContain("rug");
    const groups = Object.fromEntries(catalog.grouped().map(g => [g.key, g.entries.map(e => e.product.id)]));
    expect(groups.decor).toEqual(expect.arrayContaining(["green-velvet-mirror", "prisco-olive-rug", "cloud-checker-rug"]));
    expect(groups.chair).toEqual(expect.arrayContaining(["college-chair", "green-boucle-lounge-chair"]));
  });
  it("files shoe stacks and bookshelves under Shelves even when the analyzer called them desks", () => {
    expect(Catalog.categoryOf(testProduct("shoes", { title: "Shoe stack", category: "desk" }))).toBe("shelf");
    expect(Catalog.categoryOf(testProduct("shoes2", { title: "3-tier shoe rack organizer", category: "decor" }))).toBe("shelf");
    expect(Catalog.categoryOf(testProduct("books", { title: "Billy bookcase", category: "desk" }))).toBe("shelf");
    expect(Catalog.categoryOf(testProduct("desk", { title: "College desk", category: "desk" }))).toBe("desk");
    expect(Catalog.categoryOf(testProduct("chair", { title: "Shoe shop chair", category: "chair" }))).toBe("chair");
    const catalog = new Catalog();
    catalog.add([testProduct("shoes", { title: "Shoe stack", category: "desk" }), testProduct("desk", { title: "College desk", category: "desk" })]);
    expect(catalog.grouped().map(g => [g.label, g.entries.map(e => e.product.id)])).toEqual([["Desks", ["desk"]], ["Shelves", ["shoes"]]]);
  });
  it("restores updated sourced prices without losing a generated asset or its reviewed dimensions", async () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => values.set(key, value) });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => catalogData })));
    const product = testProduct("sourced", { priceUsd: 100, modelAssetId: "generated-asset" });
    const asset = { id: "generated-asset", productId: product.id, glbUrl: `/api/v1/models/assets/${"f".repeat(64)}.glb`, dimensionsM: product.dimensionsM, pivot: "bottom-center" as const, forwardAxis: "+Z" as const, generationMethod: "gpt-blender" as const, status: "ready" as const, disclosure: "Test" };
    saveGeneratedEntry({ product, asset });
    saveProduct({ ...product, priceUsd: 75, dimensionsM: [2, 2, 2] });
    const catalog = await Catalog.load();
    expect(catalog.get(product.id)?.product.priceUsd).toBe(75);
    expect(catalog.get(product.id)?.product.dimensionsM).toEqual(asset.dimensionsM);
    expect(catalog.get(product.id)?.asset).toEqual(asset);
    expect(catalog.get("campus-drawer-chest")?.asset?.glbUrl).toBe("/demo-assets/campus-drawer-chest.glb");
  });
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
