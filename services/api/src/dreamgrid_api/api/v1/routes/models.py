"""Cindy-facing import, confirm, poll, and asset-download endpoints."""

from typing import cast

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse

from dreamgrid_api.adapters.model_generation.models import (
    GenerateRequest,
    GenerationJob,
    PreparedImport,
    PrepareRequest,
)
from dreamgrid_api.adapters.model_generation.service import Pipeline

router = APIRouter(prefix="/models", tags=["Model generation"])


def pipeline(request: Request) -> Pipeline:
    return cast(Pipeline, request.app.state.pipeline)


@router.post("/prepare", response_model=PreparedImport)
async def prepare(body: PrepareRequest, request: Request) -> PreparedImport:
    return await pipeline(request).prepare(body)


@router.post("/generate", response_model=GenerationJob, status_code=202)
async def generate(body: GenerateRequest, request: Request) -> GenerationJob:
    return pipeline(request).generate(body)


@router.get("/jobs/{job_id}", response_model=GenerationJob)
async def job(job_id: str, request: Request) -> GenerationJob:
    return pipeline(request).get_job(job_id)


@router.get("/assets/{asset_id}.glb")
async def asset(asset_id: str, request: Request) -> FileResponse:
    return FileResponse(
        pipeline(request).asset_path(asset_id),
        media_type="model/gltf-binary",
        headers={"Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff"},
    )
