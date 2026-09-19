import furnitureSpecSchema from "../schemas/furniture-spec.schema.json" with {
  type: "json",
};
import modelPipelineSchema from "../schemas/model-pipeline.schema.json" with { type: "json" };
import modelAssetSchema from "../schemas/model-asset.schema.json" with {
  type: "json",
};
import productSchema from "../schemas/product.schema.json" with { type: "json" };
import roomSpecSchema from "../schemas/room-spec.schema.json" with {
  type: "json",
};
import roomStateSchema from "../schemas/room-state.schema.json" with {
  type: "json",
};
import sceneItemSchema from "../schemas/scene-item.schema.json" with {
  type: "json",
};

export {
  furnitureSpecSchema,
  modelPipelineSchema,
  modelAssetSchema,
  productSchema,
  roomSpecSchema,
  roomStateSchema,
  sceneItemSchema,
};

export const contractSchemas = [
  roomSpecSchema,
  productSchema,
  modelAssetSchema,
  sceneItemSchema,
  roomStateSchema,
  furnitureSpecSchema,
  modelPipelineSchema,
] as const;
