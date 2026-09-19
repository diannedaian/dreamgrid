"""Application settings loaded from environment variables."""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration for the API.

    Environment variables use the ``DREAMGRID_`` prefix. For example,
    ``DREAMGRID_ENVIRONMENT=test`` overrides ``environment``.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_prefix="DREAMGRID_",
        extra="ignore",
    )

    app_name: str = "DreamGrid API"
    app_version: str = "0.1.0"
    environment: Literal["development", "test", "production"] = "development"
    api_v1_prefix: str = "/api/v1"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"
    cors_origins: list[str] = Field(
        default_factory=lambda: ["http://localhost:3000", "http://localhost:5173"]
    )
    openai_api_key: SecretStr = Field(default=SecretStr(""), validation_alias="OPENAI_API_KEY")
    openai_model: str = "gpt-5.6-sol"
    openai_reasoning_effort: Literal["none", "low", "medium", "high"] | None = "high"
    openai_request_timeout_seconds: float = Field(default=600, ge=1, le=1200)
    openai_max_output_tokens: int = Field(default=12000, ge=100, le=32000)
    openai_max_calls: int = Field(default=30, ge=0, le=1000)
    blender_path: str = "/Applications/Blender.app/Contents/MacOS/Blender"
    project_root: Path = Path(__file__).resolve().parents[4]
    model_data_dir: Path | None = None
    product_hosts: list[str] = Field(
        default_factory=lambda: [
            "mitylite.com",
            "www.ikea.com",
            "www.target.com",
        ]
    )


@lru_cache
def get_settings() -> Settings:
    """Return one immutable-by-convention settings instance per process."""

    return Settings()
