"""FastAPI dependencies shared by versioned routes."""

from typing import cast

from fastapi import Request

from dreamgrid_api.adapters.commerce.product_sourcing_service import build_product_sourcing
from dreamgrid_api.boundaries.product_sourcing import ProductSourcingGateway
from dreamgrid_api.config import Settings


def runtime_settings(request: Request) -> Settings:
    """Read the settings attached by the application factory."""

    return cast(Settings, request.app.state.settings)


def product_sourcing(request: Request) -> ProductSourcingGateway:
    """Linda's sourcing gateway, built once per process from settings.

    Tests replace it through ``app.dependency_overrides``.
    """

    gateway = getattr(request.app.state, "product_sourcing", None)
    if gateway is None:
        gateway = build_product_sourcing(runtime_settings(request))
        request.app.state.product_sourcing = gateway
    return cast(ProductSourcingGateway, gateway)
