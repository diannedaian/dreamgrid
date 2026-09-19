"""Application settings loaded from environment variables."""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import AliasChoices, Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

_API_DIR = Path(__file__).resolve().parents[2]  # services/api
_REPO_ROOT = _API_DIR.parents[1]


class Settings(BaseSettings):
    """Runtime configuration for the API.

    Environment variables use the ``DREAMGRID_`` prefix. For example,
    ``DREAMGRID_ENVIRONMENT=test`` overrides ``environment``. Values are read
    from the process environment, then ``services/api/.env``, then the
    repository-root ``.env`` (earlier sources win).
    """

    model_config = SettingsConfigDict(
        env_file=(_REPO_ROOT / ".env", _API_DIR / ".env", ".env"),
        env_file_encoding="utf-8",
        env_prefix="DREAMGRID_",
        extra="ignore",
        populate_by_name=True,
    )

    app_name: str = "DreamGrid API"
    app_version: str = "0.1.0"
    environment: Literal["development", "test", "production"] = "development"
    api_v1_prefix: str = "/api/v1"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"
    cors_origins: list[str] = Field(
        default_factory=lambda: ["http://localhost:3000", "http://localhost:5173"]
    )

    # Linda: product sourcing (URL import + search). "auto" is live when a key is
    # present and fixture otherwise, so the demo never depends on a key.
    product_sourcing: Literal["auto", "fixture", "live"] = "auto"
    openai_api_key: SecretStr | None = Field(
        default=None,
        validation_alias=AliasChoices("DREAMGRID_OPENAI_API_KEY", "OPENAI_API_KEY", "OPENAI_KEY"),
    )
    openai_model: str = "gpt-4.1-mini"
    openai_web_search_tool: str = "web_search"
    # Product search backend. "auto": SerpAPI if its key exists, else OpenAI web search if
    # that key exists, else the fixture.
    product_search: Literal["auto", "serpapi", "openai", "fixture"] = "auto"
    serpapi_api_key: SecretStr | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "DREAMGRID_SERPAPI_API_KEY", "SERPAPI_API_KEY", "SERPAPI_KEY"
        ),
    )
    fixtures_dir: str | None = None

    @property
    def sourcing_is_live(self) -> bool:
        if self.product_sourcing == "live":
            return True
        return self.product_sourcing == "auto" and self.openai_api_key is not None

    @property
    def search_backend(self) -> Literal["serpapi", "openai", "fixture"]:
        if self.product_search != "auto":
            return self.product_search
        if self.serpapi_api_key is not None:
            return "serpapi"
        if self.sourcing_is_live and self.openai_api_key is not None:
            return "openai"
        return "fixture"


@lru_cache
def get_settings() -> Settings:
    """Return one immutable-by-convention settings instance per process."""

    return Settings()
