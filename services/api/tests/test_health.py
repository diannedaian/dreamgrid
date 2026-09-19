"""Smoke tests for the API backbone."""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from dreamgrid_api.config import Settings
from dreamgrid_api.main import create_app


@pytest.fixture
def client() -> Iterator[TestClient]:
    settings = Settings(environment="test", cors_origins=["http://localhost:3000"])
    with TestClient(create_app(settings)) as test_client:
        yield test_client


def test_versioned_health_endpoint(client: TestClient) -> None:
    response = client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "DreamGrid API",
        "version": "0.1.0",
        "environment": "test",
    }


def test_health_is_not_exposed_without_api_version(client: TestClient) -> None:
    response = client.get("/health")

    assert response.status_code == 404


def test_openapi_lists_health_route(client: TestClient) -> None:
    response = client.get("/openapi.json")

    assert response.status_code == 200
    assert "/api/v1/health" in response.json()["paths"]
