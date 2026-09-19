"""Opt-in real Blender smoke test. No API key, network, or paid model calls.

Run from the repository root: .venv/bin/python tools/blender/check_pipeline_templates.py
Outputs are reproducible and ignored under artifacts/pipeline-template-checks/.
"""

import asyncio
import json
import time
from pathlib import Path

from dreamgrid_api.adapters.model_generation.blender_runner import BlenderBuilder
from dreamgrid_api.adapters.model_generation.models import (
    TEMPLATES,
    Analysis,
    Dimensions,
)
from dreamgrid_api.adapters.model_generation.recipes import compile_recipe
from dreamgrid_api.config import Settings


async def main() -> None:
    root = Path(__file__).resolve().parents[2]
    settings = Settings(_env_file=None, project_root=root)
    builder = BlenderBuilder(settings)
    output = root / "artifacts/pipeline-template-checks"
    output.mkdir(parents=True, exist_ok=True)
    unknown = {"valueM": None, "source": "unknown", "evidence": ""}
    reports = []
    for template in TEMPLATES:
        analysis = Analysis.model_validate(
            {
                "title": "Pipeline " + template,
                "template": template,
                "frameColor": "#C79A65",
                "accentColor": "#526682",
                "drawerCount": 3,
                "drawerSide": "right",
                "shelfCount": 4,
                "width": unknown,
                "height": unknown,
                "depth": unknown,
            }
        )
        # Deliberately non-original sizes to exercise envelope fitting.
        dimensions = Dimensions(widthM=0.9, heightM=1.1, depthM=0.55)
        spec = compile_recipe(analysis, dimensions, root)
        spec_path = output / f"{template}.json"
        spec_path.write_text(json.dumps(spec, indent=2) + "\n")
        started = time.perf_counter()
        cached = await builder.build(
            spec, output / f"{template}.glb", template == "chair-sled"
        )
        reports.append(
            {
                "template": template,
                "seconds": round(time.perf_counter() - started, 3),
                "cached": cached,
                "dimensionsM": dimensions.vector(),
            }
        )
        print(json.dumps(reports[-1]), flush=True)
    (output / "report.json").write_text(json.dumps(reports, indent=2) + "\n")


if __name__ == "__main__":
    asyncio.run(main())
