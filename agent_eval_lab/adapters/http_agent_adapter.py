"""HTTP agent adapter for RAG and other HTTP-based agents."""

import logging
import os
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
        endpoint_path: str = "/agent",
        health_path: str = "/health",
        method: str = "POST",
        prompt_field: str = "query",
        response_path: str = "answer",
        auth_header: str = "Authorization",
        auth_token_env_var: str | None = None,
        auth_scheme: str = "Bearer",
    ) -> None:
        """
        Initialize HTTP agent adapter configuration.

        Args:
            base_url: Base URL of the HTTP agent service
            timeout_seconds: Request timeout in seconds
            max_retries: Maximum number of retry attempts
            endpoint_path: API path used for prompt execution
            health_path: Health endpoint path
            method: HTTP method used for execution endpoint
            prompt_field: Request field name for prompt content
            response_path: Dot-separated response field path
            auth_header: Header name for optional token auth
            auth_token_env_var: Env var containing token value
            auth_scheme: Token scheme prefix, e.g. "Bearer"
        """
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds
        self.max_retries = max_retries
        self.endpoint_path = self._normalize_path(endpoint_path, "/agent")
        self.health_path = self._normalize_path(health_path, "/health")
        self.method = (method or "POST").upper()
        self.prompt_field = (prompt_field or "query").strip()
        self.response_path = (response_path or "answer").strip()
        self.auth_header = (auth_header or "Authorization").strip()
        self.auth_token_env_var = (
            auth_token_env_var.strip() if auth_token_env_var else None
        )
        self.auth_scheme = auth_scheme.strip() if auth_scheme else ""

        allowed_methods = {"GET", "POST", "PUT", "PATCH"}
        if self.method not in allowed_methods:
            raise ProviderError(
                f"Unsupported HTTP method '{self.method}'. "
                f"Allowed methods: {sorted(allowed_methods)}"
            )
        if not self.prompt_field:
            raise ProviderError("prompt_field cannot be empty")
        if not self.response_path:
            raise ProviderError("response_path cannot be empty")
        if self.auth_token_env_var and not self.auth_header:
            raise ProviderError("auth_header cannot be empty when auth_token_env_var is set")

    @staticmethod
    def _normalize_path(path: str, fallback: str) -> str:
        cleaned = (path or "").strip() or fallback
        if not cleaned.startswith("/"):
            cleaned = f"/{cleaned}"
        return cleaned


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

    def _auth_headers(self) -> dict[str, str]:
        if not self.config.auth_token_env_var:
            return {}

        token = os.getenv(self.config.auth_token_env_var)
        if not token:
            raise ProviderError(
                f"Environment variable '{self.config.auth_token_env_var}' is required "
                f"for HTTP agent auth"
            )

        auth_scheme = (self.config.auth_scheme or "").strip().lower()
        use_raw_token = auth_scheme in {"", "none", "raw"}
        if not use_raw_token:
            header_value = f"{self.config.auth_scheme} {token}".strip()
        else:
            header_value = token

        return {self.config.auth_header: header_value}

    @staticmethod
    def _extract_by_path(payload: Any, path: str) -> Any:
        current = payload
        for segment in path.split("."):
            key = segment.strip()
            if not key:
                continue
            if isinstance(current, dict) and key in current:
                current = current[key]
            else:
                return None
        return current

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
        url = f"{self.config.base_url}{self.config.endpoint_path}"
        payload = {self.config.prompt_field: prompt}
        if metadata:
            payload["metadata"] = metadata

        last_error: Exception | None = None

        for attempt in range(self.config.max_retries):
            try:
                self.logger.debug(
                    f"Sending request to {url} (attempt {attempt + 1})"
                )

                headers = {
                    "Accept": "application/json",
                    **self._auth_headers(),
                }
                request_kwargs: dict[str, Any] = {
                    "headers": headers,
                }

                if self.config.method == "GET":
                    request_kwargs["params"] = payload
                else:
                    request_kwargs["json"] = payload
                    request_kwargs["headers"] = {
                        **headers,
                        "Content-Type": "application/json",
                    }

                response = await self.client.request(
                    self.config.method,
                    url,
                    **request_kwargs,
                )

                response.raise_for_status()

                result: Any = None
                raw_text = ""
                content_type = response.headers.get("content-type", "").lower()
                if "application/json" in content_type:
                    result = response.json()
                else:
                    raw_text = response.text
                    try:
                        result = response.json()
                    except Exception:
                        result = {"_raw_text": raw_text}

                # Extract answer from configured response path first.
                resolved = self._extract_by_path(result, self.config.response_path)
                if isinstance(resolved, str) and resolved.strip():
                    return resolved

                # Fallback for common response fields.
                for fallback_field in ("answer", "response", "output", "text"):
                    fallback_value = self._extract_by_path(result, fallback_field)
                    if isinstance(fallback_value, str) and fallback_value.strip():
                        return fallback_value

                if raw_text.strip():
                    return raw_text

                raise ProviderError(
                    f"Unexpected response format from {url}: missing readable text at "
                    f"'{self.config.response_path}'"
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
