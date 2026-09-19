"""Verify wire format and safe errors with mocked HTTP, never a real key."""

import asyncio
import json
from typing import Any

import httpx
import pytest

from dreamgrid_api.adapters.model_generation.models import PipelineError
from dreamgrid_api.adapters.model_generation.openai_analysis import OpenAIAnalyzer
from dreamgrid_api.config import Settings


def test_response_request_is_bounded_and_structured(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict[str, Any]] = []
    unknown = {"valueM": None, "source": "unknown", "evidence": ""}
    analysis = {
        "title": "Desk",
        "template": "desk-table",
        "frameColor": "#C79A65",
        "accentColor": "#526682",
        "drawerCount": 1,
        "drawerSide": "right",
        "shelfCount": 2,
        "width": unknown,
        "height": unknown,
        "depth": unknown,
    }

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
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: client)
    settings = Settings(_env_file=None, OPENAI_API_KEY="unit-test-not-a-real-key")
    result, usage = asyncio.run(
        OpenAIAnalyzer(settings).analyze("data:image/jpeg;base64,AA", "", "", None)
    )
    assert result.template == "desk-table" and usage.outputTokens == 50
    assert len(calls) == 1 and calls[0]["store"] is False
    assert calls[0]["max_output_tokens"] == 900
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
