"""Top-level router for API version 1."""

from fastapi import APIRouter

from dreamgrid_api.api.v1.routes import health, models

router = APIRouter()
router.include_router(health.router)
router.include_router(models.router)
