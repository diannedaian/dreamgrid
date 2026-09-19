// Fixture catalog until Dianne's generated assets and Linda's product feed land.
// glbUrl "fixture:<kind>" renders a procedural stand-in sized from dimensionsM.
import type { ModelAsset, Product } from "@contracts";

const IN = 0.0254;
const dims = (w: number, h: number, d: number): [number, number, number] => [w * IN, h * IN, d * IN];

export const FIXTURE_PRODUCTS: Product[] = [
  { id: "p-bed-twin", title: "Twin XL bed", category: "bed", priceUsd: 289, merchant: "Fixture", sourceUrl: "", imageUrl: "", dimensionsM: dims(39, 24, 80), styleTags: ["cozy"], colorTags: ["cream"], modelAssetId: "m-bed-twin" },
  { id: "p-desk", title: "Writing desk", category: "desk", priceUsd: 149, merchant: "Fixture", sourceUrl: "", imageUrl: "", dimensionsM: dims(47, 30, 24), styleTags: ["minimal"], colorTags: ["oak"], modelAssetId: "m-desk" },
  { id: "p-chair", title: "Desk chair", category: "chair", priceUsd: 89, merchant: "Fixture", sourceUrl: "", imageUrl: "", dimensionsM: dims(22, 34, 22), styleTags: ["minimal"], colorTags: ["white"], modelAssetId: "m-chair" },
  { id: "p-shelf", title: "5-shelf bookcase", category: "shelf", priceUsd: 119, merchant: "Fixture", sourceUrl: "", imageUrl: "", dimensionsM: dims(31, 70, 12), styleTags: ["classic"], colorTags: ["walnut"], modelAssetId: "m-shelf" },
  { id: "p-floor-lamp", title: "Arc floor lamp", category: "lamp", priceUsd: 59, merchant: "Fixture", sourceUrl: "", imageUrl: "", dimensionsM: dims(15, 64, 15), styleTags: ["warm"], colorTags: ["brass"], modelAssetId: "m-floor-lamp" },
  { id: "p-table-lamp", title: "Table lamp", category: "lamp", priceUsd: 34, merchant: "Fixture", sourceUrl: "", imageUrl: "", dimensionsM: dims(10, 18, 10), styleTags: ["warm"], colorTags: ["linen"], modelAssetId: "m-table-lamp" },
  { id: "p-rug", title: "Woven rug", category: "decor", priceUsd: 45, merchant: "Fixture", sourceUrl: "", imageUrl: "", dimensionsM: dims(60, 0.5, 84), styleTags: ["boho"], colorTags: ["sage"], modelAssetId: "m-rug" },
  { id: "p-plant", title: "Potted fern", category: "decor", priceUsd: 28, merchant: "Fixture", sourceUrl: "", imageUrl: "", dimensionsM: dims(14, 28, 14), styleTags: ["boho"], colorTags: ["green"], modelAssetId: "m-plant" },
  { id: "p-mini-fridge", title: "Mini fridge", category: "misc" as Product["category"], priceUsd: 159, merchant: "Fixture", sourceUrl: "", imageUrl: "", dimensionsM: dims(19, 33, 20), styleTags: [], colorTags: ["black"], modelAssetId: "m-mini-fridge" },
];

const asset = (id: string, productId: string, kind: string, d: [number, number, number]): ModelAsset => ({
  id, productId, glbUrl: `fixture:${kind}`, dimensionsM: d, pivot: "bottom-center", forwardAxis: "+Z", generationMethod: "public-preset", status: "ready",
  disclosure: "Procedural placeholder generated in the browser; not a real product model.",
});

export const FIXTURE_ASSETS: ModelAsset[] = FIXTURE_PRODUCTS.map((p) => {
  const kind = p.id === "p-floor-lamp" ? "floor-lamp" : p.id === "p-table-lamp" ? "table-lamp" : p.id === "p-plant" ? "plant" : p.id === "p-bed-twin" ? "bed" : "box";
  return asset(p.modelAssetId!, p.id, kind, p.dimensionsM);
});
