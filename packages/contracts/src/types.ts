/** A physical size ordered as width (X), height (Y), depth (Z), in meters. */
export type DimensionsM = [width: number, height: number, depth: number];

/** A position ordered as X, Y, Z, in meters. */
export type PositionM = [x: number, y: number, z: number];

/** Euler rotation ordered as X, Y, Z, in degrees. */
export type RotationDeg = [x: number, y: number, z: number];

export type LightingMode = "day" | "night";

export type ProductCategory =
  | "bed"
  | "desk"
  | "chair"
  | "shelf"
  | "lamp"
  | "decor";

export type GenerationMethod =
  | "gpt-blender"
  | "meshy"
  | "tripo"
  | "public-preset";

export type ModelAssetStatus = "queued" | "generating" | "ready" | "failed";

export type SceneRotationYDeg = 0 | 90 | 180 | 270;

export type RoomSpec = {
  widthM: number;
  depthM: number;
  heightM: number;
  gridSizeM: number;
  lightingMode: LightingMode;
};

export type Product = {
  id: string;
  title: string;
  category: ProductCategory;
  priceUsd: number;
  merchant: string;
  sourceUrl: string;
  imageUrl: string;
  dimensionsM: DimensionsM;
  styleTags: string[];
  colorTags: string[];
  modelAssetId?: string;
};

export type ModelAsset = {
  id: string;
  productId: string;
  glbUrl: string;
  previewUrl?: string;
  dimensionsM: DimensionsM;
  pivot: "bottom-center";
  forwardAxis: "+Z";
  generationMethod: GenerationMethod;
  status: ModelAssetStatus;
  disclosure: string;
};

export type SceneItem = {
  id: string;
  productId: string;
  modelAssetId: string;
  positionM: PositionM;
  rotationYDeg: SceneRotationYDeg;
};

export type RoomState = {
  room: RoomSpec;
  budgetUsd: number;
  items: SceneItem[];
};

/**
 * The restricted vocabulary accepted by the trusted Blender interpreter.
 * `dimensionsM` is always the part's width/height/depth bounding box.
 */
export type FurniturePrimitive = "box" | "rounded-box" | "cylinder" | "shade";

export type FurniturePartRole =
  | "body"
  | "top"
  | "leg"
  | "shelf"
  | "support"
  | "accent";

export type FurnitureMaterial = {
  id: string;
  name: string;
  baseColorHex: string;
  roughness: number;
  metallic: number;
};

export type PartRepeat = {
  count: number;
  offsetM: PositionM;
};

export type FurniturePart = {
  id: string;
  primitive: FurniturePrimitive;
  role: FurniturePartRole;
  dimensionsM: DimensionsM;
  positionM: PositionM;
  rotationDeg: RotationDeg;
  materialId: string;
  cornerRadiusM?: number;
  repeat?: PartRepeat;
};

/**
 * Declarative, schema-validated model output. It deliberately has no field for
 * code, scripts, API calls, file paths, or arbitrary Blender operations.
 */
export type FurnitureSpec = {
  schemaVersion: "1.0";
  name: string;
  category: ProductCategory;
  dimensionsM: DimensionsM;
  materials: FurnitureMaterial[];
  parts: FurniturePart[];
};
