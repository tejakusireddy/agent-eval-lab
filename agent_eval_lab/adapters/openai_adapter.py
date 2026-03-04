"""OpenAI adapter implementation."""

import asyncio
import os
from typing import Any

import httpx

from agent_eval_lab.adapters.base import AgentAdapter
from agent_eval_lab.config import OpenAIConfig
from agent_eval_lab.errors import ProviderError


class OpenAIAdapterConfig:
    """Configuration for OpenAI adapter with extended options."""

    def __init__(
        self,
        model: str = "gpt-4o-mini",
        base_url: str | None = None,
        timeout_seconds: float = 30.0,
        max_concurrent_requests: int = 4,
        temperature: float = 0.0,
        max_tokens: int = 512,
    ) -> None:
        """Initialize OpenAI adapter configuration."""
        self.model = model
        self.base_url = base_url
        self.timeout_seconds = timeout_seconds
        self.max_concurrent_requests = max_concurrent_requests
        self.temperature = temperature
        self.max_tokens = max_tokens


class OpenAIAdapter(AgentAdapter):
    """
    Adapter for OpenAI's API.

    Features:
    - Async HTTP client with configurable timeout
    - Retry logic with exponential backoff for 429 and 5xx errors
    - Concurrency limiting via semaphore
    - Support for temperature and max_tokens
    """

    def __init__(self, config: OpenAIConfig | OpenAIAdapterConfig) -> None:
        """
        Initialize the OpenAI adapter.

        Args:
            config: OpenAI configuration

        Raises:
            ProviderError: If OPENAI_API_KEY is not set
        """
        self.config = config
        self.api_key = os.getenv("OPENAI_API_KEY")

        if not self.api_key:
            raise ProviderError(
                "OPENAI_API_KEY environment variable is not set. "
                "Please set it before running evaluations."
            )

        # Handle both OpenAIConfig and OpenAIAdapterConfig
        base_url = getattr(config, "base_url", None) or "https://api.openai.com/v1"
        timeout = getattr(config, "timeout_seconds", 30.0)
        max_concurrent = getattr(config, "max_concurrent_requests", 4)

        self.client = httpx.AsyncClient(
            base_url=base_url,
            timeout=timeout,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
        )

        # Semaphore for concurrency limiting
        self._semaphore = asyncio.Semaphore(max_concurrent)

    async def generate(
        self,
        prompt: str,
        metadata: dict[str, Any] | None = None,
    ) -> str:
        """
        Generate a response from OpenAI.

        Args:
            prompt: The prompt to send
            metadata: Optional metadata (not used in v0.1)

        Returns:
            The response text from the model

        Raises:
            ProviderError: If the request fails after retries

        TODO:
            - Support streaming responses
            - Support multi-message prompts
            - Support tool calling
        """
        async with self._semaphore:
            max_retries = 3
            base_delay = 1.0

            for attempt in range(max_retries):
                try:
                    # Build request payload
                    model = getattr(self.config, "model", "gpt-4o-mini")
                    payload: dict[str, Any] = {
                        "model": model,
                        "messages": [{"role": "user", "content": prompt}],
                    }

                    # Add optional parameters if available
                    temp = getattr(self.config, "temperature", None)
                    if temp is not None:
                        payload["temperature"] = temp

                    max_toks = getattr(self.config, "max_tokens", None)
                    if max_toks is not None:
                        payload["max_tokens"] = max_toks

                    response = await self.client.post(
                        "/chat/completions",
                        json=payload,
                    )

                    # Handle rate limiting and server errors with retry
                    if response.status_code == 429:
                        if attempt < max_retries - 1:
                            delay = base_delay * (2**attempt)
                            await asyncio.sleep(delay)
                            continue
                        raise ProviderError(
                            f"Rate limited after {max_retries} attempts"
                        )

                    if response.status_code >= 500:
                        if attempt < max_retries - 1:
                            delay = base_delay * (2**attempt)
                            await asyncio.sleep(delay)
                            continue
                        raise ProviderError(
                            f"Server error {response.status_code} "
                            f"after {max_retries} attempts"
                        )

                    response.raise_for_status()
                    data = response.json()

                    # Extract content from response
                    choices = data.get("choices", [])
                    if not choices:
                        raise ProviderError("No choices in OpenAI response")

                    message = choices[0].get("message", {})
                    content = message.get("content", "")

                    if not content:
                        raise ProviderError("Empty content in OpenAI response")

                    return str(content)

                except httpx.HTTPError as e:
                    if attempt == max_retries - 1:
                        raise ProviderError(
                            f"HTTP error after {max_retries} attempts: {e}"
                        ) from e
                    delay = base_delay * (2**attempt)
                    await asyncio.sleep(delay)

            raise ProviderError(f"Failed after {max_retries} attempts")

    async def close(self) -> None:
        """Close the HTTP client."""
        await self.client.aclose()

