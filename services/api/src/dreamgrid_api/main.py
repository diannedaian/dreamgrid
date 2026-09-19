"""FastAPI application factory and default ASGI application."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from dreamgrid_api.api.v1.router import router as api_v1_router
from dreamgrid_api.config import Settings, get_settings


def create_app(settings: Settings | None = None) -> FastAPI:
    """Create an API instance with explicit, testable configuration."""

    runtime_settings = settings or get_settings()
    app = FastAPI(
        title=runtime_settings.app_name,
        version=runtime_settings.app_version,
        docs_url="/docs" if runtime_settings.environment != "production" else None,
        redoc_url=None,
    )
    app.state.settings = runtime_settings

    app.add_middleware(
        CORSMiddleware,
        allow_origins=runtime_settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(api_v1_router, prefix=runtime_settings.api_v1_prefix)
    return app


app = create_app()
