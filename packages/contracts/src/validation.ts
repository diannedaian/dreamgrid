import {
  Ajv2020,
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020.js";

import { contractSchemas } from "./schemas.js";
import type {
  FurnitureSpec,
  ModelAsset,
  Product,
  RoomSpec,
  RoomState,
  SceneItem,
} from "./types.js";

export const contractValidator = new Ajv2020({
  allErrors: true,
  strict: true,
});

for (const schema of contractSchemas) {
  contractValidator.addSchema(schema);
}

function validatorFor<T>(schemaId: string): ValidateFunction<T> {
  const validator = contractValidator.getSchema<T>(schemaId);
  if (!validator) {
    throw new Error(`DreamGrid contract schema is not registered: ${schemaId}`);
  }
  return validator;
}

export const validateRoomSpec = validatorFor<RoomSpec>(
  "https://dreamgrid.dev/schemas/room-spec.schema.json",
);
export const validateProduct = validatorFor<Product>(
  "https://dreamgrid.dev/schemas/product.schema.json",
);
export const validateModelAsset = validatorFor<ModelAsset>(
  "https://dreamgrid.dev/schemas/model-asset.schema.json",
);
export const validateSceneItem = validatorFor<SceneItem>(
  "https://dreamgrid.dev/schemas/scene-item.schema.json",
);
export const validateRoomState = validatorFor<RoomState>(
  "https://dreamgrid.dev/schemas/room-state.schema.json",
);
export const validateFurnitureSpec = validatorFor<FurnitureSpec>(
  "https://dreamgrid.dev/schemas/furniture-spec.schema.json",
);

export class ContractValidationError extends Error {
  readonly contract: string;
  readonly validationErrors: ErrorObject[];

  constructor(contract: string, validationErrors: ErrorObject[]) {
    const details = validationErrors
      .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
      .join("; ");
    super(`${contract} validation failed: ${details}`);
    this.name = "ContractValidationError";
    this.contract = contract;
    this.validationErrors = validationErrors;
  }
}

export function assertValidContract<T>(
  contract: string,
  validator: ValidateFunction<T>,
  candidate: unknown,
): asserts candidate is T {
  if (!validator(candidate)) {
    throw new ContractValidationError(contract, validator.errors ?? []);
  }
}
