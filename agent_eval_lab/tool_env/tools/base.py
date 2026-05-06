"""Core tool types and abstract base for the adversarial tool environment."""

from __future__ import annotations

from abc import ABC, abstractmethod
from enum import Enum
from typing import TYPE_CHECKING, Any

from pydantic import BaseModel, Field

if TYPE_CHECKING:
    from agent_eval_lab.tool_env.session import Session


class ToolMode(str, Enum):
    """Adversarial / reliability mode for tool responses."""

    BENIGN = "benign"
    AMBIGUOUS = "ambiguous"
    MALICIOUS = "malicious"
    STALE = "stale"
    PARTIAL_FAILURE = "partial_failure"


class ToolResult(BaseModel):
    """Structured outcome of a single tool invocation."""

    success: bool
    data: dict[str, Any] | None = None
    error: str | None = None
    mode: ToolMode = ToolMode.BENIGN
    policy_checked: bool = False
    policy_decision: str | None = None  # "allow" | "deny" | "audit"


class ToolCallRequest(BaseModel):
    """HTTP body for POST /tools/call."""

    tool: str
    args: dict[str, Any] = Field(default_factory=dict)
    session_id: str
    run_id: str | None = None


class ToolCallResponse(BaseModel):
    """HTTP response for a tool invocation."""

    spec_version: str = "1.0"
    session_id: str
    tool: str
    result: ToolResult
    span_id: str
    trace_emitted: bool = False


class BaseTool(ABC):
    """
    Abstract base for all tool surfaces.

    Each concrete tool validates args, checks policy (via server), executes in
    the given :class:`ToolMode`, and mutates session state when applicable.
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """Stable tool identifier (e.g. ``filesystem``)."""
        ...

    @property
    @abstractmethod
    def description(self) -> str:
        """Human-readable description for discovery."""
        ...

    @abstractmethod
    def execute(
        self,
        args: dict[str, Any],
        session: Session,
        mode: ToolMode,
    ) -> ToolResult:
        """Run the tool; must not raise (return ``ToolResult(success=False)``)."""
        ...

    def validate_args(self, args: dict[str, Any]) -> tuple[bool, str]:
        """
        Validate args before execution.

        Returns:
            ``(True, "")`` if valid, else ``(False, error_message)``.
        """
        _ = args
        return True, ""

    @property
    def operations(self) -> list[str]:
        """Operation names this tool supports (for discovery)."""
        return []
