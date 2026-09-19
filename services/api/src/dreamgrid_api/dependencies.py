"""FastAPI dependencies shared by versioned routes."""

from typing import cast

from fastapi import Request

from dreamgrid_api.config import Settings


def runtime_settings(request: Request) -> Settings:
    """Read the settings attached by the application factory."""

    return cast(Settings, request.app.state.settings)
