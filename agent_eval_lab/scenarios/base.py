"""Base classes for evaluation scenarios."""

import abc
from typing import Any

from pydantic import BaseModel


class Scenario(BaseModel, abc.ABC):
    """
    Abstract base class for evaluation scenarios.

    Each scenario defines a test case that evaluates an agent's behavior.
    """

    id: str
    name: str
    description: str
    tags: list[str] = []

    @abc.abstractmethod
    def build_prompt(self) -> str:
        """
        Build the prompt to send to the agent.

        Returns:
            The prompt string to evaluate
        """
        ...

    def expected_behavior(self) -> str | None:
        """
        Return a description of the expected behavior for this scenario.

        Returns:
            Description of expected behavior, or None if not specified
        """
        return None


class ScenarioResult(BaseModel):
    """
    Result of executing a scenario.

    This model is designed to be serializable and suitable for reporting.
    """

    scenario_id: str
    success: bool
    score: float
    status: str = "UNKNOWN"  # PASS, FAIL_MINOR, FAIL_CRITICAL
    tags: list[str]
    raw_prompt: str
    raw_response: str
    reasoning: str = ""
    metadata: dict[str, Any] = {}
    fail_reasons: list[str] = []

