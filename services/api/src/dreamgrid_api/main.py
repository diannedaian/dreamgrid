"""FastAPI application factory and default ASGI application."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from dreamgrid_api.adapters.model_generation.models import PipelineError
from dreamgrid_api.adapters.model_generation.service import Pipeline
from dreamgrid_api.api.v1.router import router as api_v1_router
from dreamgrid_api.body_limit import BodyLimit
from dreamgrid_api.config import Settings, get_settings


def create_app(settings: Settings | None = None, pipeline: Pipeline | None = None) -> FastAPI:
    """Create an API instance with explicit, testable configuration."""

    runtime_settings = settings or get_settings()
    model_pipeline = pipeline or Pipeline(runtime_settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        yield
        await model_pipeline.close()

    app = FastAPI(
        title=runtime_settings.app_name,
        version=runtime_settings.app_version,
        docs_url="/docs" if runtime_settings.environment != "production" else None,
        redoc_url=None,
        lifespan=lifespan,
    )
    app.state.settings = runtime_settings
    app.state.pipeline = model_pipeline
    app.add_middleware(BodyLimit)

    @app.exception_handler(PipelineError)
    async def pipeline_error(request: Request, error: PipelineError) -> JSONResponse:
        return JSONResponse({"detail": str(error)}, status_code=error.status)

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request: Request, error: RequestValidationError) -> JSONResponse:
        # Pydantic's default error objects echo input values; never echo uploaded images.
        return JSONResponse(
            {
                "detail": [
                    {"loc": item["loc"], "msg": item["msg"], "type": item["type"]}
                    for item in error.errors()
                ]
            },
            status_code=422,
        )

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
