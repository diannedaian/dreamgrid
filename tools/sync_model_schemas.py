"""Mechanically synchronize pipeline Pydantic schemas and optional lighting metadata."""

import json
from pathlib import Path

from dreamgrid_api.adapters.model_generation.geometry import Lighting
from dreamgrid_api.adapters.model_generation.models import (
    GenerateRequest,
    GenerationJob,
    PreparedImport,
    PrepareRequest,
)

ROOT = Path(__file__).resolve().parents[1] / "packages/contracts/schemas"


def main():
    asset_path = ROOT / "model-asset.schema.json"
    asset = json.loads(asset_path.read_text())
    light = Lighting.model_json_schema()
    asset["$defs"].update(light.pop("$defs", {}))
    asset["$defs"]["Lighting"] = light
    asset["properties"]["lighting"] = {"$ref": "#/$defs/Lighting"}
    asset_path.write_text(json.dumps(asset, indent=2) + "\n")

    definitions = {}
    for model in [PrepareRequest, PreparedImport, GenerateRequest, GenerationJob]:
        schema = model.model_json_schema()
        definitions.update(schema.pop("$defs", {}))
        definitions[model.__name__] = schema
    # Canonical ModelAsset, not an unconstrained provider object.
    definitions["GenerationJob"]["properties"]["asset"] = {"anyOf": [
        {"$ref": "https://dreamgrid.dev/schemas/model-asset.schema.json"}, {"type": "null"}
    ], "default": None}
    # Inline canonical asset and its definitions so Python's offline validator never fetches URLs.
    nested = {k: v for k, v in asset.items() if k not in {"$schema", "$id", "$defs"}}
    definitions.update(asset["$defs"])
    definitions["ModelAsset"] = nested
    definitions["GenerationJob"]["properties"]["asset"]["anyOf"][0] = {"$ref": "#/$defs/ModelAsset"}
    document = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "https://dreamgrid.dev/schemas/model-pipeline.schema.json",
        "title": "ModelPipeline", "$defs": definitions,
    }
    (ROOT / "model-pipeline.schema.json").write_text(json.dumps(document, indent=2) + "\n")


if __name__ == "__main__":
    main()
