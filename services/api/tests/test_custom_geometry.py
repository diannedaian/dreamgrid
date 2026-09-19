"""Custom composition and lighting tests; no live provider or Blender dependency."""

import asyncio
import copy
import json
import struct
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator
from pydantic import ValidationError
from test_model_pipeline import FakeBuilder, image_data

from dreamgrid_api.adapters.model_generation.geometry import (
    ImageGeometry,
    compile_geometry,
    lighting_from_glb,
)
from dreamgrid_api.adapters.model_generation.models import Dimensions, Usage
from dreamgrid_api.adapters.model_generation.service import Pipeline
from dreamgrid_api.config import Settings
from dreamgrid_api.main import create_app

ROOT = Path(__file__).resolve().parents[3]


def geometry_data():
    unknown = {"valueM": None, "source": "unknown", "evidence": ""}
    return {
        "title": "Custom curved sculptural light",
        "category": "lamp",
        "supported": True,
        "limitations": ["Back is not visible"],
        "width": unknown,
        "height": unknown,
        "depth": unknown,
        "referenceSize": [0.6, 1.7, 0.3],
        "materials": [{"id": "bulb", "color": "#FFFFFF", "roughness": 0.4, "metallic": 0}],
        "parts": [
            {
                "id": "custom-shape",
                "primitive": "sphere",
                "size": [0.1, 0.1, 0.1],
                "position": [0, 0.5, 0],
                "rotation": [0, 0, 0],
                "material": "bulb",
                "bevel": 0,
                "profile": [],
                "path": [],
                "tubeRadius": 0,
            }
        ],
        "lights": [
            {
                "id": "top",
                "position": [0, 0.5, 0],
                "direction": [0, 1, 0],
                "kind": "spot",
                "glowMaterials": ["bulb"],
            }
        ],
    }


def test_custom_geometry_preserves_image_authored_parts():
    data = geometry_data()
    arm = copy.deepcopy(data["parts"][0])
    arm.update(
        id="curved-arm",
        primitive="tube",
        size=[0.3, 0.2, 0.01],
        path=[[0, 0, 0], [0.1, 0.2, 0], [0.3, 0.1, 0]],
        tubeRadius=0.005,
    )
    bowl = copy.deepcopy(data["parts"][0])
    bowl.update(
        id="open-bowl",
        primitive="lathe",
        size=[0.3, 0.1, 0.3],
        profile=[
            {"radius": r, "height": h}
            for r, h in [(0.02, 0), (0.15, 0.1), (0.145, 0.1), (0.015, 0.005)]
        ],
    )
    data["parts"] += [arm, bowl]
    spec = compile_geometry(
        ImageGeometry.model_validate(data), Dimensions(widthM=0.6, heightM=1.7, depthM=0.3), ROOT
    )
    assert [p["id"] for p in spec["parts"]] == ["custom-shape", "curved-arm", "open-bowl"]
    assert spec["parts"][1]["pathM"] == arm["path"]
    assert spec["lights"][0]["direction"] == [0, 1, 0]


@pytest.mark.parametrize(
    "failure", ["material", "glow", "duplicate", "zero-direction", "tube", "script"]
)
def test_invalid_compositions_fail_closed(failure):
    data = geometry_data()
    if failure == "material":
        data["parts"][0]["material"] = "missing"
    elif failure == "glow":
        data["lights"][0]["glowMaterials"] = ["missing"]
    elif failure == "duplicate":
        data["parts"].append(copy.deepcopy(data["parts"][0]))
    elif failure == "zero-direction":
        data["lights"][0]["direction"] = [0, 0, 0]
    elif failure == "tube":
        data["parts"][0]["primitive"] = "tube"
    else:
        data["script"] = "not executable"
    with pytest.raises(ValidationError):
        ImageGeometry.model_validate(data)


def test_custom_prepare_does_not_choose_category_template_and_estimates_stay_labeled(tmp_path):
    class CustomAnalyzer:
        calls = 0

        async def analyze(self, *args):
            self.calls += 1
            data = geometry_data()
            data["lights"] = []
            return ImageGeometry.model_validate(data), Usage(inputTokens=100, outputTokens=200)

    settings = Settings(_env_file=None, model_data_dir=tmp_path)
    analyzer = CustomAnalyzer()
    pipeline = Pipeline(settings, analyzer, FakeBuilder())
    with TestClient(create_app(settings, pipeline)) as client:
        prepared = client.post("/api/v1/models/prepare", json={"imageDataUrl": image_data()}).json()
        assert prepared["template"] == "custom"
        assert prepared["dimensions"]["height"]["valueM"] == 1.7  # no 45cm table-lamp default
        request = {
            "importId": prepared["importId"],
            "productId": "test",
            "confirmed": True,
            "dimensions": {"widthM": 0.52, "heightM": 1.8161, "depthM": 0.2413},
            "estimatedAxes": ["width", "depth"],
        }
        assert client.post("/api/v1/models/generate", json=request).status_code == 400
        result = client.post("/api/v1/models/generate", json={**request, "acceptEstimated": True})
        assert result.status_code == 202
        assert result.json()["dimensions"]["width"]["source"] == "estimated"
        assert analyzer.calls == 1

        async def complete():
            await asyncio.gather(*pipeline.tasks)

        client.portal.call(complete)
        job = client.get("/api/v1/models/jobs/" + result.json()["jobId"]).json()
        assert job["status"] == "ready"
        assert "image-specific" in job["asset"]["disclosure"]


def test_glb_carries_normalized_lighting_and_canonical_contract(tmp_path):
    rig = {
        "coordinateSpace": "model-local",
        "activation": "night",
        "disclosure": "Estimated",
        "sources": [
            {
                "id": "top",
                "type": "spot",
                "positionM": [0, 1.7, 0],
                "direction": [0, 1, 0],
                "colorHex": "#FFF1D6",
                "intensityCd": 40,
                "rangeM": 5,
                "coneAngleRad": 0.9,
                "penumbra": 0.5,
                "emissiveMaterialNames": ["DG_bulb"],
            }
        ],
    }
    data = json.dumps({"nodes": [{"extras": {"dreamgridLighting": rig}}]}).encode()
    data += b" " * (-len(data) % 4)
    path = tmp_path / "light.glb"
    path.write_bytes(
        b"glTF" + struct.pack("<IIII", 2, len(data) + 20, len(data), 0x4E4F534A) + data
    )
    assert lighting_from_glb(path) == rig
    schema = json.loads((ROOT / "packages/contracts/schemas/model-asset.schema.json").read_text())
    Draft202012Validator({"$defs": schema["$defs"], "$ref": "#/$defs/Lighting"}).validate(rig)


def test_decor_prepare_generate_and_download_through_api(tmp_path):
    class PlantAnalyzer:
        calls = 0

        async def analyze(self, image, product_text, page_text, hint):
            assert hint == "decor"
            self.calls += 1
            data = geometry_data()
            data.update(title="Stylized plant", category="decor", lights=[])
            return ImageGeometry.model_validate(data), Usage(inputTokens=1, outputTokens=1)

    settings = Settings(_env_file=None, model_data_dir=tmp_path)
    analyzer, builder = PlantAnalyzer(), FakeBuilder()
    pipeline = Pipeline(settings, analyzer, builder)
    with TestClient(create_app(settings, pipeline)) as client:
        response = client.post("/api/v1/models/prepare", json={
            "imageDataUrl": image_data(), "categoryHint": "decor",
        })
        assert response.status_code == 200
        prepared = response.json()
        assert prepared["category"] == "decor" and prepared["template"] == "custom"
        assert all(m["source"] == "estimated" for m in prepared["dimensions"].values())
        spec = compile_geometry(pipeline.imports[prepared["importId"]].analysis,
                                Dimensions(widthM=.6, heightM=1.7, depthM=.3), ROOT)
        assert spec["category"] == "decor" and spec["lights"] == []
        generated = client.post("/api/v1/models/generate", json={
            "importId": prepared["importId"], "productId": "plant-test",
            "dimensions": {"widthM": .6, "heightM": 1.7, "depthM": .3},
            "confirmed": True, "acceptEstimated": True,
            "estimatedAxes": ["width", "height", "depth"],
        })
        assert generated.status_code == 202

        async def complete():
            await asyncio.gather(*pipeline.tasks)

        client.portal.call(complete)
        job = client.get("/api/v1/models/jobs/" + generated.json()["jobId"]).json()
        assert job["status"] == "ready" and "lighting" not in job["asset"]
        assert client.get(job["asset"]["glbUrl"]).content.startswith(b"glTF")
        assert analyzer.calls == builder.calls == 1


def test_decor_preset_fails_clearly_without_provider_or_builder(tmp_path):
    settings = Settings(_env_file=None, model_data_dir=tmp_path, OPENAI_API_KEY="")
    builder = FakeBuilder()
    pipeline = Pipeline(settings, builder=builder)
    with TestClient(create_app(settings, pipeline)) as client:
        response = client.post("/api/v1/models/prepare", json={
            "imageDataUrl": image_data(), "categoryHint": "decor", "mode": "preset",
        })
        assert response.status_code == 400
        assert "No decor preset" in response.json()["detail"]
        assert pipeline.ai_calls == builder.calls == 0


def test_shared_plant_fixture_matches_python_and_json_contract():
    from dreamgrid_api.adapters.model_generation.models import PreparedImport

    value = json.loads((ROOT / "fixtures/plant-prepared-import.json").read_text())
    assert PreparedImport.model_validate(value).category == "decor"
    schema = json.loads(
        (ROOT / "packages/contracts/schemas/model-pipeline.schema.json").read_text()
    )
    Draft202012Validator({**schema, "$ref": "#/$defs/PreparedImport"}).validate(value)
