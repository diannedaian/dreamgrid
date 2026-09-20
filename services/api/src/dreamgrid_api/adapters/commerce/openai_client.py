"""Minimal OpenAI Responses API client used by the commerce adapters.

Kept to one call shape so tests can fake it: send instructions + input, get
text back. The SDK is deliberately not a dependency; ``httpx`` is enough.
"""

import json
import re
from dataclasses import dataclass
from typing import Any, Protocol

import httpx

OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"
DEFAULT_TIMEOUT_SECONDS = 60.0
# Bounds cost and stops a runaway repetition loop from producing megabytes of output.
DEFAULT_MAX_OUTPUT_TOKENS = 3000


class OpenAIError(Exception):
    """The API call failed; the message is safe to surface as a note."""


@dataclass(frozen=True)
class JsonSchemaFormat:
    name: str
    schema: dict[str, Any]


@dataclass(frozen=True)
class ModelReply:
    """Output text plus the URLs the web-search tool actually cited (empty without the tool)."""

    text: str
    cited_urls: tuple[str, ...] = ()


class TextModel(Protocol):
    """One structured-output completion. Tools such as web search are optional."""

    async def complete(
        self,
        *,
        instructions: str,
        user_input: str,
        output: JsonSchemaFormat | None = None,
        tools: tuple[dict[str, Any], ...] = (),
    ) -> ModelReply:
        """``output`` None means free text; web-search citations only arrive in that mode."""
        ...


class OpenAIResponsesModel:
    def __init__(self, api_key: str, model: str, client: httpx.AsyncClient | None = None) -> None:
        self._api_key = api_key
        self._model = model
        self._client = client

    async def complete(
        self,
        *,
        instructions: str,
        user_input: str,
        output: JsonSchemaFormat | None = None,
        tools: tuple[dict[str, Any], ...] = (),
    ) -> ModelReply:
        body: dict[str, Any] = {
            "model": self._model,
            "instructions": instructions,
            "input": user_input,
            "max_output_tokens": DEFAULT_MAX_OUTPUT_TOKENS,
        }
        if output is not None:
            body["text"] = {
                "format": {
                    "type": "json_schema",
                    "name": output.name,
                    "schema": output.schema,
                    "strict": True,
                }
            }
        if tools:
            body["tools"] = list(tools)

        client = self._client or httpx.AsyncClient(timeout=DEFAULT_TIMEOUT_SECONDS)
        try:
            response = await client.post(
                OPENAI_RESPONSES_URL,
                headers={"Authorization": f"Bearer {self._api_key}"},
                json=body,
            )
        except httpx.HTTPError as error:
            raise OpenAIError(f"OpenAI request failed ({error.__class__.__name__}).") from error
        finally:
            if self._client is None:
                await client.aclose()

        if response.status_code >= 400:
            raise OpenAIError(f"OpenAI answered HTTP {response.status_code}.")
        payload = response.json()
        return ModelReply(text=extract_output_text(payload), cited_urls=extract_cited_urls(payload))


def extract_output_text(payload: Any) -> str:
    """Concatenate the ``output_text`` parts of a Responses API payload."""

    if isinstance(payload, dict) and isinstance(payload.get("output_text"), str):
        return str(payload["output_text"])
    parts: list[str] = []
    output = payload.get("output", []) if isinstance(payload, dict) else []
    for item in output:
        if not isinstance(item, dict) or item.get("type") != "message":
            continue
        for content in item.get("content", []):
            if isinstance(content, dict) and content.get("type") == "output_text":
                parts.append(str(content.get("text", "")))
    if not parts:
        raise OpenAIError("OpenAI returned no text output.")
    return "".join(parts)


def extract_cited_urls(payload: Any) -> tuple[str, ...]:
    """URLs from ``url_citation`` annotations: pages the search tool really surfaced."""

    found: list[str] = []
    output = payload.get("output", []) if isinstance(payload, dict) else []
    for item in output:
        if not isinstance(item, dict) or item.get("type") != "message":
            continue
        for content in item.get("content", []):
            if not isinstance(content, dict):
                continue
            for annotation in content.get("annotations", []) or []:
                if isinstance(annotation, dict) and annotation.get("type") == "url_citation":
                    url = annotation.get("url")
                    if isinstance(url, str) and url not in found:
                        found.append(url)
    return tuple(found)


def parse_json_object(text: str) -> dict[str, Any]:
    """Parse model output as a JSON object, tolerating code fences or prose around it."""

    candidate = text.strip()
    fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", candidate, re.DOTALL)
    if fenced:
        candidate = fenced.group(1)
    elif not candidate.startswith("{"):
        start, end = candidate.find("{"), candidate.rfind("}")
        if start >= 0 and end > start:
            candidate = candidate[start : end + 1]
    try:
        parsed = json.loads(candidate)
    except json.JSONDecodeError as error:
        raise OpenAIError("OpenAI output was not valid JSON.") from error
    if not isinstance(parsed, dict):
        raise OpenAIError("OpenAI output was not a JSON object.")
    return parsed
