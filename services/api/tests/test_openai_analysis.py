"""Verify wire format and safe errors with mocked HTTP, never a real key."""

import asyncio
import json
from pathlib import Path
from typing import Any

import httpx
import pytest
from test_custom_geometry import geometry_data

from dreamgrid_api.adapters.model_generation.models import PipelineError
from dreamgrid_api.adapters.model_generation.openai_analysis import OpenAIAnalyzer
from dreamgrid_api.config import Settings


def test_response_request_is_bounded_and_structured(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict[str, Any]] = []
    client_options: dict[str, Any] = {}
    analysis = geometry_data()

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "status": "completed",
                "usage": {"input_tokens": 100, "output_tokens": 50},
                "output": [
                    {
                        "type": "message",
                        "content": [{"type": "output_text", "text": json.dumps(analysis)}],
                    }
                ],
            },
        )

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

    def factory(**kwargs: Any) -> httpx.AsyncClient:
        client_options.update(kwargs)
        return client

    monkeypatch.setattr(httpx, "AsyncClient", factory)
    settings = Settings(_env_file=None, OPENAI_API_KEY="unit-test-not-a-real-key")
    result, usage = asyncio.run(
        OpenAIAnalyzer(settings).analyze("data:image/jpeg;base64,AA", "", "", None)
    )
    assert result.parts[0].primitive == "sphere" and usage.outputTokens == 50
    assert len(calls) == 1 and calls[0]["store"] is False
    assert calls[0]["model"] == "gpt-5.6-sol"
    assert calls[0]["reasoning"] == {"effort": "high"}
    assert calls[0]["max_output_tokens"] == 12000
    assert client_options == {"timeout": 600, "trust_env": False}
    assert calls[0]["text"]["format"]["strict"] is True
    assert "unit-test-not-a-real-key" not in json.dumps(calls)


@pytest.mark.parametrize(
    "status,body",
    [
        (401, {"error": "private-provider-details"}),
        (200, {"status": "incomplete"}),
        (200, {"status": "completed", "output": []}),
    ],
)
def test_provider_failures_are_sanitized(
    monkeypatch: pytest.MonkeyPatch,
    status: int,
    body: dict[str, Any],
) -> None:
    client = httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda request: httpx.Response(status, json=body),
        )
    )
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: client)
    with pytest.raises(PipelineError) as caught:
        asyncio.run(
            OpenAIAnalyzer(
                Settings(
                    _env_file=None,
                    OPENAI_API_KEY="unit-test-not-a-real-key",
                )
            ).analyze("image", "", "", None)
        )
    assert "private-provider-details" not in str(caught.value)


def test_missing_key_never_calls_network(monkeypatch: pytest.MonkeyPatch) -> None:
    def forbidden(**kwargs: Any) -> None:
        raise AssertionError("Network must not be called without a key")

    monkeypatch.setattr(httpx, "AsyncClient", forbidden)
    with pytest.raises(PipelineError, match="OPENAI_API_KEY"):
        asyncio.run(
            OpenAIAnalyzer(Settings(_env_file=None, OPENAI_API_KEY="")).analyze(
                "image", "", "", None
            )
        )


def test_benchmark_overrides_and_safe_diagnostics(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    calls: list[dict[str, Any]] = []
    client_options: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "model": "gpt-5.6-sol",
                "status": "completed",
                "usage": {
                    "input_tokens": 100,
                    "output_tokens": 50,
                    "output_tokens_details": {"reasoning_tokens": 20},
                },
                "output": [
                    {
                        "type": "message",
                        "content": [{"type": "output_text", "text": json.dumps(geometry_data())}],
                    }
                ],
            },
        )

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

    def factory(**kwargs: Any) -> httpx.AsyncClient:
        client_options.update(kwargs)
        return client

    monkeypatch.setattr(httpx, "AsyncClient", factory)
    output = tmp_path / "geometry.json"
    asyncio.run(
        OpenAIAnalyzer(
            Settings(
                _env_file=None,
                OPENAI_API_KEY="unit-test-not-a-real-key",
                openai_model="gpt-5.6-sol",
                openai_reasoning_effort="high",
            ),
            output,
            request_timeout=300,
            max_output_tokens=10000,
        ).analyze("data:image/jpeg;base64,PRIVATE_IMAGE", "private-input", "", None)
    )
    assert client_options["timeout"] == 300
    assert len(calls) == 1 and calls[0]["max_output_tokens"] == 10000
    assert calls[0]["reasoning"] == {"effort": "high"}
    metadata = json.loads(output.with_suffix(".metadata.json").read_text())
    assert metadata["model"] == "gpt-5.6-sol"
    assert metadata["usage"]["output_tokens_details"]["reasoning_tokens"] == 20
    assert metadata["requestSeconds"] >= 0
    diagnostics = output.read_text() + json.dumps(metadata)
    assert "unit-test-not-a-real-key" not in diagnostics
    assert "private-input" not in diagnostics and "PRIVATE_IMAGE" not in diagnostics


def test_analyzer_uses_environment_limits(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DREAMGRID_OPENAI_MAX_OUTPUT_TOKENS", "8000")
    monkeypatch.setenv("DREAMGRID_OPENAI_REQUEST_TIMEOUT_SECONDS", "240")
    analyzer = OpenAIAnalyzer(Settings(_env_file=None))
    assert analyzer.max_output_tokens == 8000
    assert analyzer.request_timeout == 240
