"""Abstract base class for agent adapters."""

import abc
from typing import Any


class AgentAdapter(abc.ABC):
    """
    Abstract interface for agent adapters.

    Each adapter provides a unified interface to interact with different
    AI agent providers (OpenAI, Anthropic, etc.).
    """

    @abc.abstractmethod
    async def generate(
        self,
        prompt: str,
        metadata: dict[str, Any] | None = None,
    ) -> str:
        """
        Send a prompt to the underlying agent and return the raw response text.

        Args:
            prompt: The prompt to send to the agent
            metadata: Optional metadata to pass along (for logging, etc.)

        Returns:
            The raw response text from the agent

        Raises:
            ProviderError: If there's an error communicating with the provider
        """
        ...

