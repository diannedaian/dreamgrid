// Canonical DreamGrid contracts. Locked after T+1 — see docs/PROJECT_MANIFESTO.md §5.
// All runtime geometry is in meters. Floor is y = 0, origin is the center of the floor.

export type RoomSpec = {
  widthM: number;
  depthM: number;
  heightM: number;
  gridSizeM: number;
  lightingMode: "day" | "night";
};

export type Product = {
  id: string;
  title: string;
  category: "bed" | "desk" | "chair" | "shelf" | "lamp" | "decor";
  priceUsd: number;
  merchant: string;
  sourceUrl: string;
  imageUrl: string;
  dimensionsM: [width: number, height: number, depth: number];
  styleTags: string[];
  colorTags: string[];
  modelAssetId?: string;
};

export type ModelAsset = {
  id: string;
  productId: string;
  glbUrl: string;
  previewUrl?: string;
  dimensionsM: [width: number, height: number, depth: number];
  pivot: "bottom-center";
  forwardAxis: "+Z";
  generationMethod: "gpt-blender" | "meshy" | "tripo" | "public-preset";
  status: "queued" | "generating" | "ready" | "failed";
  disclosure: string;
};

export type SceneItem = {
  id: string;
  productId: string;
  modelAssetId: string;
  positionM: [x: number, y: number, z: number];
  rotationYDeg: 0 | 90 | 180 | 270;
};

export type RoomState = {
  room: RoomSpec;
  budgetUsd: number;
  items: SceneItem[];
};
