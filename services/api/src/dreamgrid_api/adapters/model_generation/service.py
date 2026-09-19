"""Single-process laptop orchestration; bounded RAM state, no database or broker."""

import asyncio
import hashlib
import json
import math
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast
from uuid import uuid4

from dreamgrid_api.config import Settings

from .blender_runner import BlenderBuilder, Builder
from .geometry import ImageGeometry, compile_geometry, lighting_from_glb
from .image_input import normalize_image
from .measurements import quoted_meters
from .models import (
    TEMPLATES,
    Analysis,
    DimensionReview,
    Dimensions,
    GenerateRequest,
    GenerationJob,
    Measurement,
    ObservedDimension,
    PipelineError,
    PreparedImport,
    PrepareRequest,
    Source,
    Template,
    Usage,
)
from .openai_analysis import Analyzer, OpenAIAnalyzer
from .product_page import fetch_product_text
from .recipes import STYLE_VERSION, compile_recipe


@dataclass
class ImportRecord:
    analysis: ImageGeometry | Analysis
    prepared: PreparedImport
    expires: float


def compile_model(
    analysis: ImageGeometry | Analysis, dimensions: Dimensions, root: Path
) -> dict[str, Any]:
    if isinstance(analysis, ImageGeometry):
        return compile_geometry(analysis, dimensions, root)
    return compile_recipe(analysis, dimensions, root)


class Pipeline:
    def __init__(
        self,
        settings: Settings,
        analyzer: Analyzer | None = None,
        builder: Builder | None = None,
    ) -> None:
        self.settings = settings
        self.analyzer = analyzer or OpenAIAnalyzer(settings)
        self.builder = builder or BlenderBuilder(settings)
        self.directory = (
            settings.model_data_dir or settings.project_root / "artifacts/generated-models"
        )
        self.imports: dict[str, ImportRecord] = {}
        self.jobs: dict[str, GenerationJob] = {}
        self.analysis_cache: dict[str, ImportRecord] = {}
        self.job_keys: dict[str, str] = {}
        self.tasks: set[asyncio.Task[None]] = set()
        self.worker = asyncio.Semaphore(1)
        self.preparing = False
        self.ai_calls = 0

    async def close(self) -> None:
        for task in self.tasks:
            task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)

    async def prepare(self, request: PrepareRequest) -> PreparedImport:
        if self.preparing:
            raise PipelineError("Another image is being analyzed; retry shortly.", 429)
        self.preparing = True
        try:
            return await self._prepare(request)
        finally:
            self.preparing = False

    async def _prepare(self, request: PrepareRequest) -> PreparedImport:
        now = time.time()
        self.imports = {key: value for key, value in self.imports.items() if value.expires > now}
        if len(self.imports) >= 100:
            raise PipelineError("This demo session is full. Restart the backend to clear it.", 429)
        image = await asyncio.to_thread(normalize_image, request.imageDataUrl)
        cache_key = hashlib.sha256(
            json.dumps(
                [
                    image,
                    request.sourceUrl,
                    request.productText,
                    request.categoryHint,
                    request.mode,
                    self.settings.openai_model,
                    self.settings.openai_reasoning_effort,
                    STYLE_VERSION,
                ]
            ).encode()
        ).hexdigest()
        cached = self.analysis_cache.get(cache_key)
        if cached and cached.expires > now:
            prepared = cached.prepared.model_copy(deep=True)
            prepared.importId = uuid4().hex
            prepared.usage = Usage(cached=True)
            self.imports[prepared.importId] = ImportRecord(
                cached.analysis, prepared, cached.expires
            )
            return prepared
        warnings = ["Image-based reconstruction; verify the preview. Hidden geometry is uncertain."]
        analysis: ImageGeometry | Analysis
        page_text = ""
        if request.mode == "preset":
            if request.categoryHint is None:
                raise PipelineError("Choose a category for explicit preset mode.")
            template = "desk-pedestal" if request.categoryHint == "desk" else request.categoryHint
            if template not in TEMPLATES:
                raise PipelineError(
                    "No decor preset exists. Use live image generation for plants and decor."
                )
            unknown = ObservedDimension(valueM=None, source="unknown", evidence="")
            analysis = Analysis(
                title="Approximate " + request.categoryHint,
                template=template,
                frameColor="#C79A65",
                accentColor="#526682",
                drawerCount=3,
                drawerSide="right",
                shelfCount=4,
                width=unknown,
                height=unknown,
                depth=unknown,
            )
            usage = Usage()
            warnings.append("Preset mode: the image was NOT analyzed by AI.")
        else:
            if self.ai_calls >= self.settings.openai_max_calls:
                raise PipelineError(
                    "Session AI-call limit reached. Use preset mode or adjust the backend cap.", 429
                )
            if request.sourceUrl:
                try:
                    page_text = await asyncio.wait_for(
                        asyncio.to_thread(
                            fetch_product_text,
                            request.sourceUrl,
                            self.settings.product_hosts,
                        ),
                        timeout=10,
                    )
                    if not page_text:
                        warnings.append(
                            "No readable dimensions found at the link; paste the specifications."
                        )
                except (PipelineError, TimeoutError):
                    warnings.append(
                        "Link lookup unavailable; paste specifications or review estimated sizes."
                    )
            self.ai_calls += 1
            analysis, usage = await self.analyzer.analyze(
                image,
                request.productText,
                page_text,
                request.categoryHint,
            )
        if (isinstance(analysis, ImageGeometry) and not analysis.supported) or (
            isinstance(analysis, Analysis) and analysis.template == "unsupported"
        ):
            raise PipelineError(
                "Shape cannot be represented reliably. Supply another view or provider.",
                422,
            )
        if isinstance(analysis, ImageGeometry):
            category, defaults = analysis.category, analysis.referenceSize
            preset_label = "Image-inferred size; not a product measurement"
            warnings.extend(analysis.limitations)
            # Fail invalid geometry at prepare, before asking the user to accept it.
            compile_geometry(
                analysis,
                Dimensions(widthM=defaults[0], heightM=defaults[1], depthM=defaults[2]),
                self.settings.project_root,
            )
        else:
            category, defaults, preset_label = TEMPLATES[analysis.template]
        measurements: dict[str, Measurement] = {}
        for axis, fallback in zip(["width", "height", "depth"], defaults, strict=True):
            observed = cast(ObservedDimension, getattr(analysis, axis))
            value = observed.valueM
            text = request.productText if observed.source == "product_text" else page_text
            grounded = bool(observed.evidence.strip()) and (
                observed.source == "image_label"
                or (
                    observed.source in {"product_text", "product_url"}
                    and observed.evidence.casefold() in text.casefold()
                )
            )
            if value is not None and math.isfinite(value) and 0.05 <= value <= 5 and grounded:
                converted = quoted_meters(observed.evidence)
                if converted is not None and 0.05 <= converted <= 5:
                    value = converted
                measurements[axis] = Measurement(
                    valueM=value,
                    source=cast(Source, observed.source),
                    evidence=observed.evidence[:240],
                )
            else:
                measurements[axis] = Measurement(
                    valueM=fallback,
                    source="estimated",
                    evidence=preset_label,
                )
        if any(item.source == "estimated" for item in measurements.values()):
            warnings.append(
                "Some sizes are estimates. Confirm them explicitly or replace with measurements."
            )
        prepared = PreparedImport(
            importId=uuid4().hex,
            expiresAt=datetime.fromtimestamp(now + 3600, UTC).isoformat(),
            title=analysis.title[:100],
            category=category,
            template="custom"
            if isinstance(analysis, ImageGeometry)
            else cast(Template, analysis.template),
            dimensions=DimensionReview(**measurements),
            warnings=warnings,
            analysisMethod="gpt" if request.mode == "live" else "preset",
            usage=usage,
        )
        record = ImportRecord(analysis, prepared, now + 3600)
        self.imports[prepared.importId] = record
        if len(self.analysis_cache) >= 32:
            self.analysis_cache.pop(next(iter(self.analysis_cache)))
        self.analysis_cache[cache_key] = record
        return prepared

    def generate(self, request: GenerateRequest) -> GenerationJob:
        record = self.imports.get(request.importId)
        if not record or record.expires < time.time():
            raise PipelineError(
                "Import expired or backend restarted. Prepare the image again.", 404
            )
        review = record.prepared.dimensions.model_copy(deep=True)
        for axis, value in zip(
            ["width", "height", "depth"], request.dimensions.vector(), strict=True
        ):
            measurement = cast(Measurement, getattr(review, axis))
            if axis in request.estimatedAxes:
                measurement.valueM = value
                measurement.source = "estimated"
                measurement.evidence = "User-confirmed estimate; not a measured product dimension"
            elif abs(measurement.valueM - value) > 1e-8:
                measurement.valueM = value
                measurement.source = "user"
                measurement.evidence = "User-entered measurement"
            if measurement.source == "estimated" and not request.acceptEstimated:
                raise PipelineError(
                    "Explicitly accept estimated sizes or enter measured dimensions."
                )
        spec = compile_model(record.analysis, request.dimensions, self.settings.project_root)
        digest = hashlib.sha256(
            (STYLE_VERSION + json.dumps(spec, sort_keys=True)).encode()
        ).hexdigest()
        key = json.dumps([request.importId, request.productId, digest])
        existing_id = self.job_keys.get(key)
        if existing_id and self.jobs[existing_id].status != "failed":
            return self.jobs[existing_id]
        if len(self.tasks) >= 4:
            raise PipelineError("The laptop has four pending builds. Retry shortly.", 429)
        if len(self.jobs) >= 100:
            raise PipelineError("This demo session is full. Restart the backend to clear it.", 429)
        job = GenerationJob(jobId=uuid4().hex, status="queued", dimensions=review)
        self.jobs[job.jobId] = job
        self.job_keys[key] = job.jobId
        task = asyncio.create_task(self._build(job, request, record, digest))
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)
        return job

    async def _build(
        self,
        job: GenerationJob,
        request: GenerateRequest,
        record: ImportRecord,
        digest: str,
    ) -> None:
        try:
            async with self.worker:
                job.status = "generating"
                spec = compile_model(
                    record.analysis, request.dimensions, self.settings.project_root
                )
                job.cached = await self.builder.build(
                    spec,
                    self.directory / f"{digest}.glb",
                    isinstance(record.analysis, Analysis)
                    and record.analysis.template == "chair-sled",
                )
                estimated = any(
                    getattr(job.dimensions, axis).source == "estimated"
                    for axis in ["width", "height", "depth"]
                )
                method = (
                    "gpt-blender" if record.prepared.analysisMethod == "gpt" else "public-preset"
                )
                job.asset = {
                    "id": "asset-" + digest,
                    "productId": request.productId,
                    "glbUrl": f"{self.settings.api_v1_prefix}/models/assets/{digest}.glb",
                    "dimensionsM": request.dimensions.vector(),
                    "pivot": "bottom-center",
                    "forwardAxis": "+Z",
                    "generationMethod": method,
                    "status": "ready",
                    "disclosure": (
                        "GPT-authored image-specific geometry built in Blender. "
                        if method == "gpt-blender"
                        else "Explicit original DreamGrid preset; image not analyzed by AI. "
                    )
                    + "Simplified appearance, not exact reconstruction. "
                    + (
                        "Includes user-accepted estimated dimensions; do not assume exact fit."
                        if estimated
                        else "Confirmed outer size; interior details are estimated."
                    ),
                }
                if spec.get("lights"):
                    job.asset["lighting"] = lighting_from_glb(self.directory / f"{digest}.glb")
                job.status = "ready"
        except asyncio.CancelledError:
            job.status, job.error = "failed", "Backend stopped; retry generation."
            raise
        except Exception as error:
            job.status = "failed"
            job.error = (
                str(error)
                if isinstance(error, PipelineError)
                else "Model build failed; retry or use a preset."
            )

    def get_job(self, identifier: str) -> GenerationJob:
        if identifier not in self.jobs:
            raise PipelineError("Job not found; the backend may have restarted.", 404)
        return self.jobs[identifier]

    def asset_path(self, identifier: str) -> Path:
        if len(identifier) != 64 or any(char not in "0123456789abcdef" for char in identifier):
            raise PipelineError("Asset not found.", 404)
        path = self.directory / f"{identifier}.glb"
        if not path.is_file():
            raise PipelineError("Asset not found.", 404)
        return path
