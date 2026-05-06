"""Base classes for evaluation scenarios."""

import abc
from typing import Any

from pydantic import BaseModel, Field, computed_field, field_validator, model_validator

from agent_eval_lab.evaluator.scoring import ScenarioStatus
from agent_eval_lab.scenarios.loader import ScenarioDefinition

_CANONICAL_SCORES: frozenset[float] = frozenset({0.0, 25.0, 50.0, 100.0})


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

    @abc.abstractmethod
    def get_definition(self) -> ScenarioDefinition:
        """
        Return the scenario definition used for canonical evaluation.

        Returns:
            Definition containing criteria, tags, and templates for scoring.
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
    status: ScenarioStatus
    score: float
    tags: list[str]
    raw_prompt: str
    raw_response: str
    reasoning: str = ""
    metadata: dict[str, Any] = {}
    fail_reasons: list[str] = []
    grader_results: list[dict[str, Any]] = Field(default_factory=list)

    @field_validator("score")
    @classmethod
    def validate_canonical_score(cls, value: float) -> float:
        """
        Ensure score is one of the canonical evaluation values.

        Args:
            value: Raw score from construction or assignment.

        Returns:
            The validated score.

        Raises:
            ValueError: If the score is not in the allowed set.
        """
        if value not in _CANONICAL_SCORES:
            raise ValueError(
                f"score must be one of {sorted(_CANONICAL_SCORES)}, got {value!r}"
            )
        return value

    @model_validator(mode="after")
    def validate_status_score_consistency(self) -> "ScenarioResult":
        """
        Ensure status and score agree with the canonical scoring regime.

        Returns:
            ``self`` when valid.

        Raises:
            ValueError: When ``status`` and ``score`` are inconsistent.
        """
        if self.status == ScenarioStatus.FAIL_CRITICAL:
            if self.score != 0.0:
                raise ValueError(
                    "FAIL_CRITICAL requires score 0.0, "
                    f"got score={self.score!r}"
                )
        elif self.status == ScenarioStatus.FAIL_MINOR:
            if self.score not in (25.0, 50.0):
                raise ValueError(
                    "FAIL_MINOR requires score 25.0 or 50.0, "
                    f"got score={self.score!r}"
                )
        elif self.status == ScenarioStatus.PASS:
            if self.score != 100.0:
                raise ValueError(
                    "PASS requires score 100.0, "
                    f"got score={self.score!r}"
                )
        return self

    @computed_field
    @property
    def success(self) -> bool:
        """DEPRECATED: use status instead."""
        return self.status == ScenarioStatus.PASS
