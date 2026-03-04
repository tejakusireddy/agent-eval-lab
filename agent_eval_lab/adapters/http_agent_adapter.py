"""HTTP agent adapter for RAG and other HTTP-based agents."""

import logging
from typing import Any

import httpx

from agent_eval_lab.adapters.base import AgentAdapter
from agent_eval_lab.errors import ProviderError


class HttpAgentAdapterConfig:
    """Configuration for HTTP agent adapter."""

    def __init__(
        self,
        base_url: str = "http://localhost:8000",
        timeout_seconds: float = 30.0,
        max_retries: int = 3,
    ) -> None:
        """
        Initialize HTTP agent adapter configuration.

        Args:
            base_url: Base URL of the HTTP agent service
            timeout_seconds: Request timeout in seconds
            max_retries: Maximum number of retry attempts
        """
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds
        self.max_retries = max_retries


class HttpAgentAdapter(AgentAdapter):
    """
    Adapter for HTTP-based agent services (e.g., RAG service).

    Features:
    - Async HTTP client with configurable timeout
    - Retry logic for transient errors
    - Error handling and logging
    """

    def __init__(self, config: HttpAgentAdapterConfig) -> None:
        """
        Initialize the HTTP agent adapter.

        Args:
            config: Configuration for the adapter
        """
        self.config = config
        self.logger = logging.getLogger(__name__)
        self.client = httpx.AsyncClient(
            timeout=httpx.Timeout(config.timeout_seconds),
            follow_redirects=True,
        )

    async def generate(
        self,
        prompt: str,
        metadata: dict[str, Any] | None = None,
    ) -> str:
        """
        Send a prompt to the HTTP agent service and return the response.

        Args:
            prompt: The prompt/query to send to the agent
            metadata: Optional metadata (not used for HTTP adapter)

        Returns:
            The agent's response text

        Raises:
            ProviderError: If there's an error communicating with the service
        """
        url = f"{self.config.base_url}/agent"
        payload = {"query": prompt}

        last_error: Exception | None = None

        for attempt in range(self.config.max_retries):
            try:
                self.logger.debug(
                    f"Sending request to {url} (attempt {attempt + 1})"
                )

                response = await self.client.post(
                    url,
                    json=payload,
                    headers={"Content-Type": "application/json"},
                )

                response.raise_for_status()

                result = response.json()

                # Extract answer from response
                if "answer" in result:
                    return result["answer"]
                else:
                    raise ProviderError(
                        f"Unexpected response format from {url}: "
                        f"missing 'answer' field"
                    )

            except httpx.HTTPStatusError as e:
                last_error = e
                if e.response.status_code < 500:
                    # Client error, don't retry
                    raise ProviderError(
                        f"HTTP {e.response.status_code} error from {url}: "
                        f"{e.response.text}"
                    ) from e
                # Server error, retry
                self.logger.warning(
                    f"Server error {e.response.status_code}, "
                    f"retrying... (attempt {attempt + 1}/{self.config.max_retries})"
                )

            except httpx.TimeoutException as e:
                last_error = e
                self.logger.warning(
                    f"Request timeout, retrying... "
                    f"(attempt {attempt + 1}/{self.config.max_retries})"
                )

            except httpx.RequestError as e:
                last_error = e
                self.logger.warning(
                    f"Request error: {e}, retrying... "
                    f"(attempt {attempt + 1}/{self.config.max_retries})"
                )

            except Exception as e:
                raise ProviderError(
                    f"Unexpected error communicating with {url}: {e}"
                ) from e

        # All retries exhausted
        raise ProviderError(
            f"Failed to get response from {url} after "
            f"{self.config.max_retries} attempts: {last_error}"
        ) from last_error

    async def close(self) -> None:
        """Close the HTTP client."""
        await self.client.aclose()

