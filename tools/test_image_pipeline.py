"""Opt-in paid image pipeline smoke test. Never invoked by CI.

Saves the provider's exact geometry before building, so builder debugging needs no new API call.
"""

import argparse
import asyncio
import base64
import json
import time
from datetime import UTC, datetime
from pathlib import Path

from dreamgrid_api.adapters.model_generation.geometry import ImageGeometry, compile_geometry
from dreamgrid_api.adapters.model_generation.models import GenerateRequest, PrepareRequest, Usage
from dreamgrid_api.adapters.model_generation.service import Pipeline
from dreamgrid_api.adapters.model_generation.openai_analysis import OpenAIAnalyzer
from dreamgrid_api.config import Settings


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True, type=Path)
    parser.add_argument("--context", required=True)
    parser.add_argument("--size", nargs=3, type=float, required=True, metavar=("WIDTH", "HEIGHT", "DEPTH"))
    parser.add_argument("--estimated-axes", nargs="*", default=[], choices=["width", "height", "depth"])
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--reuse-analysis", action="store_true")
    parser.add_argument("--request-timeout", type=float, help="Override backend timeout setting")
    parser.add_argument("--max-output-tokens", type=int, help="Override backend output-token cap")
    parser.add_argument("--category", choices=["bed", "desk", "chair", "shelf", "lamp", "decor"])
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    settings = Settings(_env_file=root / "services/api/.env")
    if args.request_timeout is None:
        args.request_timeout = settings.openai_request_timeout_seconds
    if args.max_output_tokens is None:
        args.max_output_tokens = settings.openai_max_output_tokens
    args.output.mkdir(parents=True, exist_ok=True)
    analysis_path = args.output / "analysis.json"

    class SavedAnalyzer:
        async def analyze(self, *args):
            return ImageGeometry.model_validate_json(analysis_path.read_text()), Usage(cached=True)

    pipeline = Pipeline(settings, analyzer=SavedAnalyzer() if args.reuse_analysis else
                        OpenAIAnalyzer(settings, args.output / "provider-geometry.json",
                                       request_timeout=args.request_timeout,
                                       max_output_tokens=args.max_output_tokens))
    started = time.perf_counter()
    result = {
        "startedAt": datetime.now(UTC).isoformat(),
        "model": settings.openai_model,
        "reasoningEffort": settings.openai_reasoning_effort,
        "maxOutputTokens": args.max_output_tokens,
        "requestTimeoutSeconds": args.request_timeout,
        "reusedAnalysis": args.reuse_analysis,
        "measurementBoundary": "Local image read through validated GLB ready; no URL lookup, human wait, browser upload/download or preview render",
    }
    stage = "prepare"
    print(f"Starting {settings.openai_model}, reasoning={settings.openai_reasoning_effort}; one call, no retries.", flush=True)
    try:
        prepared = await pipeline.prepare(PrepareRequest(
            imageDataUrl="data:image/png;base64," + base64.b64encode(args.image.read_bytes()).decode(),
            productText=args.context,
            categoryHint=args.category,
        ))
        elapsed_analysis = time.perf_counter() - started
        result["analysisSeconds"] = round(elapsed_analysis, 4)
        print(f"Image analysis and validation finished in {elapsed_analysis:.2f}s; building GLB.", flush=True)
        record = pipeline.imports[prepared.importId]
        analysis_path.write_text(record.analysis.model_dump_json(indent=2))
        request = GenerateRequest(
            importId=prepared.importId, productId="live-custom-image-test",
            dimensions={"widthM": args.size[0], "heightM": args.size[1], "depthM": args.size[2]},
            confirmed=True, acceptEstimated=True, estimatedAxes=args.estimated_axes,
        )
        recipe = compile_geometry(record.analysis, request.dimensions, root)
        (args.output / "recipe.json").write_text(json.dumps(recipe, indent=2))
        stage = "build"
        build_started = time.perf_counter()
        job = pipeline.generate(request)
        await asyncio.gather(*pipeline.tasks)
        result.update({
            "buildSeconds": round(time.perf_counter() - build_started, 4),
            "totalSeconds": round(time.perf_counter() - started, 4),
            "prepared": prepared.model_dump(), "job": job.model_dump(),
            "aiCalls": pipeline.ai_calls,
            "partCount": len(record.analysis.parts),
            "status": job.status,
        })
        (args.output / "result.json").write_text(json.dumps(result, indent=2))
        print(json.dumps(result, indent=2))
        if job.status != "ready":
            raise SystemExit(1)
    except Exception as error:
        result.update({"status": "failed", "failedStage": stage,
                       "totalSeconds": round(time.perf_counter() - started, 4),
                       "errorType": type(error).__name__, "error": str(error),
                       "aiCalls": pipeline.ai_calls})
        (args.output / "result.json").write_text(json.dumps(result, indent=2))
        print(json.dumps(result, indent=2), flush=True)
        raise SystemExit(1) from None
    finally:
        await pipeline.close()


if __name__ == "__main__":
    asyncio.run(main())
