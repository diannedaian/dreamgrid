"""Service health endpoint."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from dreamgrid_api.config import Settings
from dreamgrid_api.dependencies import runtime_settings

router = APIRouter(tags=["system"])


class HealthResponse(BaseModel):
    """Stable response used by local development and deployment probes."""

    status: Literal["ok"] = "ok"
    service: str
    version: str
    environment: str


@router.get("/health", response_model=HealthResponse)
async def health_check(
    settings: Annotated[Settings, Depends(runtime_settings)],
) -> HealthResponse:
    """Report process health without checking unconfigured external services."""

    return HealthResponse(
        service=settings.app_name,
        version=settings.app_version,
        environment=settings.environment,
    )
