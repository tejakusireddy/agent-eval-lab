"""Tests for the configurable HTTP agent adapter."""

import asyncio

import httpx
import pytest

from agent_eval_lab.adapters.http_agent_adapter import (
    HttpAgentAdapter,
    HttpAgentAdapterConfig,
)
from agent_eval_lab.errors import ProviderError


def test_generate_supports_configurable_response_path() -> None:
    """Adapter should extract response text from nested response_path."""
    config = HttpAgentAdapterConfig(
        base_url="http://example.com",
        endpoint_path="/v2/respond",
        response_path="data.output.text",
    )
    adapter = HttpAgentAdapter(config)

    async def fake_request(method: str, url: str, **kwargs: object) -> httpx.Response:
        request = httpx.Request(method, url)
        return httpx.Response(
            200,
            json={"data": {"output": {"text": "hello from nested path"}}},
            request=request,
        )

    adapter.client.request = fake_request  # type: ignore[assignment]

    try:
        result = asyncio.run(adapter.generate("hello"))
        assert result == "hello from nested path"
    finally:
        asyncio.run(adapter.close())


def test_generate_get_method_uses_prompt_field_as_query_param() -> None:
    """GET adapters should send prompt in query params using prompt_field."""
    config = HttpAgentAdapterConfig(
        base_url="http://example.com",
        method="GET",
        prompt_field="prompt",
        response_path="answer",
    )
    adapter = HttpAgentAdapter(config)
    captured: dict[str, object] = {}

    async def fake_request(method: str, url: str, **kwargs: object) -> httpx.Response:
        captured["method"] = method
        captured["url"] = url
        captured["kwargs"] = kwargs
        request = httpx.Request(method, url)
        return httpx.Response(200, json={"answer": "ok"}, request=request)

    adapter.client.request = fake_request  # type: ignore[assignment]

    try:
        result = asyncio.run(adapter.generate("ping test"))
        assert result == "ok"
        assert captured["method"] == "GET"
        kwargs = captured["kwargs"]
        assert isinstance(kwargs, dict)
        assert kwargs["params"] == {"prompt": "ping test"}
    finally:
        asyncio.run(adapter.close())


def test_generate_requires_auth_env_var_when_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    """If auth_token_env_var is configured but missing, adapter should fail fast."""
    monkeypatch.delenv("MISSING_TOKEN", raising=False)

    config = HttpAgentAdapterConfig(
        base_url="http://example.com",
        auth_token_env_var="MISSING_TOKEN",
    )
    adapter = HttpAgentAdapter(config)

    try:
        with pytest.raises(ProviderError, match="MISSING_TOKEN"):
            asyncio.run(adapter.generate("hello"))
    finally:
        asyncio.run(adapter.close())


def test_generate_supports_raw_auth_scheme(monkeypatch: pytest.MonkeyPatch) -> None:
    """Auth scheme 'raw' should send token without Bearer prefix."""
    monkeypatch.setenv("RAW_TOKEN", "token-123")

    config = HttpAgentAdapterConfig(
        base_url="http://example.com",
        auth_header="x-api-key",
        auth_token_env_var="RAW_TOKEN",
        auth_scheme="raw",
    )
    adapter = HttpAgentAdapter(config)
    captured: dict[str, object] = {}

    async def fake_request(method: str, url: str, **kwargs: object) -> httpx.Response:
        captured["headers"] = kwargs.get("headers", {})
        request = httpx.Request(method, url)
        return httpx.Response(200, json={"answer": "ok"}, request=request)

    adapter.client.request = fake_request  # type: ignore[assignment]

    try:
        result = asyncio.run(adapter.generate("hello"))
        assert result == "ok"
        headers = captured.get("headers")
        assert isinstance(headers, dict)
        assert headers.get("x-api-key") == "token-123"
    finally:
        asyncio.run(adapter.close())
