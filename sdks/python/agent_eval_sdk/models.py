"""Pydantic v2 models for thin SDK trace events (Run Spec v1.0)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field

SPEC_VERSION: Literal["1.0"] = "1.0"

_PREVIEW_MAX = 500


def _truncate_preview(text: str | None) -> str | None:
    """Truncate preview fields to match wire max length (same limit as EvalTracer)."""
    if text is None:
        return None
    if len(text) <= _PREVIEW_MAX:
        return text
    return text[:_PREVIEW_MAX]


EventType = Literal[
    "run_started",
    "model_call",
    "tool_call",
    "tool_result",
    "policy_decision",
    "human_approval",
    "run_completed",
    "run_failed",
]


def utc_iso_timestamp() -> str:
    """Return current UTC time as ISO 8601 string."""
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace(
        "+00:00", "Z"
    )


class RunStartedPayload(BaseModel):
    """Payload for a ``run_started`` event."""

    agent_id: str | None = None
    scenario_id: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class ToolCallPayload(BaseModel):
    """Payload for a ``tool_call`` event."""

    tool_name: str
    tool_input: dict[str, Any] = Field(default_factory=dict)
    span_id: str


class RunCompletedPayload(BaseModel):
    """Payload for a ``run_completed`` event."""

    duration_ms: int | None = None
    output_preview: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class RunFailedPayload(BaseModel):
    """Payload for a ``run_failed`` event."""

    error: str
    error_type: str | None = None
    duration_ms: int | None = None


class ModelCallPayload(BaseModel):
    """Payload for a ``model_call`` event."""

    model: str
    prompt_preview: str | None = None
    response_preview: str | None = None
    duration_ms: int | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class ToolResultPayload(BaseModel):
    """Payload for a ``tool_result`` event."""

    tool_name: str
    span_id: str
    success: bool
    result_preview: str | None = None
    error: str | None = None
    duration_ms: int | None = None


class PolicyDecisionPayload(BaseModel):
    """Payload for a ``policy_decision`` event."""

    decision: Literal["allow", "deny", "audit"]
    policy_id: str | None = None
    resource: str | None = None
    reason: str
    span_id: str | None = None


class HumanApprovalPayload(BaseModel):
    """Payload for a ``human_approval`` event."""

    approved: bool
    approver_id: str | None = None
    reason: str | None = None
    span_id: str | None = None
    timeout_seconds: int | None = None


class ThinTraceEvent(BaseModel):
    """Wire format for POST /api/v1/sdk/events."""

    spec_version: Literal["1.0"] = "1.0"
    event_type: EventType
    run_id: str
    evaluation_id: str | None = None
    timestamp: str
    payload: dict[str, Any]

    def to_wire_dict(self) -> dict[str, Any]:
        """Serialize to JSON-compatible dict (payload is already expanded)."""
        return self.model_dump(mode="json", exclude_none=True)


def build_run_started_event(
    *,
    run_id: str,
    evaluation_id: str | None,
    agent_id: str | None,
    scenario_id: str | None,
    metadata: dict[str, Any] | None,
) -> ThinTraceEvent:
    """Build a ``run_started`` trace event."""
    p = RunStartedPayload(
        agent_id=agent_id,
        scenario_id=scenario_id,
        metadata=metadata or {},
    )
    return ThinTraceEvent(
        event_type="run_started",
        run_id=run_id,
        evaluation_id=evaluation_id,
        timestamp=utc_iso_timestamp(),
        payload=p.model_dump(mode="json"),
    )


def build_tool_call_event(
    *,
    run_id: str,
    evaluation_id: str | None,
    tool_name: str,
    tool_input: dict[str, Any] | None,
    span_id: str,
) -> ThinTraceEvent:
    """Build a ``tool_call`` trace event."""
    p = ToolCallPayload(
        tool_name=tool_name,
        tool_input=tool_input or {},
        span_id=span_id,
    )
    return ThinTraceEvent(
        event_type="tool_call",
        run_id=run_id,
        evaluation_id=evaluation_id,
        timestamp=utc_iso_timestamp(),
        payload=p.model_dump(mode="json"),
    )


def build_run_completed_event(
    *,
    run_id: str,
    evaluation_id: str | None,
    duration_ms: int | None,
    output_preview: str | None,
    metadata: dict[str, Any] | None,
) -> ThinTraceEvent:
    """Build a ``run_completed`` trace event."""
    p = RunCompletedPayload(
        duration_ms=duration_ms,
        output_preview=output_preview,
        metadata=metadata or {},
    )
    return ThinTraceEvent(
        event_type="run_completed",
        run_id=run_id,
        evaluation_id=evaluation_id,
        timestamp=utc_iso_timestamp(),
        payload=p.model_dump(mode="json"),
    )


def build_run_failed_event(
    *,
    run_id: str,
    evaluation_id: str | None,
    error: str,
    error_type: str | None,
    duration_ms: int | None,
) -> ThinTraceEvent:
    """Build a ``run_failed`` trace event."""
    p = RunFailedPayload(
        error=error,
        error_type=error_type,
        duration_ms=duration_ms,
    )
    return ThinTraceEvent(
        event_type="run_failed",
        run_id=run_id,
        evaluation_id=evaluation_id,
        timestamp=utc_iso_timestamp(),
        payload=p.model_dump(mode="json"),
    )


def build_model_call_event(
    *,
    run_id: str,
    evaluation_id: str | None,
    model: str,
    prompt_preview: str | None,
    response_preview: str | None,
    duration_ms: int | None,
    input_tokens: int | None,
    output_tokens: int | None,
    metadata: dict[str, Any] | None,
) -> ThinTraceEvent:
    """Build a ``model_call`` trace event."""
    p = ModelCallPayload(
        model=model,
        prompt_preview=_truncate_preview(prompt_preview),
        response_preview=_truncate_preview(response_preview),
        duration_ms=duration_ms,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        metadata=metadata or {},
    )
    return ThinTraceEvent(
        event_type="model_call",
        run_id=run_id,
        evaluation_id=evaluation_id,
        timestamp=utc_iso_timestamp(),
        payload=p.model_dump(mode="json"),
    )


def build_tool_result_event(
    *,
    run_id: str,
    evaluation_id: str | None,
    tool_name: str,
    span_id: str,
    success: bool,
    result_preview: str | None,
    error: str | None,
    duration_ms: int | None,
) -> ThinTraceEvent:
    """Build a ``tool_result`` trace event."""
    p = ToolResultPayload(
        tool_name=tool_name,
        span_id=span_id,
        success=success,
        result_preview=_truncate_preview(result_preview),
        error=error,
        duration_ms=duration_ms,
    )
    return ThinTraceEvent(
        event_type="tool_result",
        run_id=run_id,
        evaluation_id=evaluation_id,
        timestamp=utc_iso_timestamp(),
        payload=p.model_dump(mode="json"),
    )


def build_policy_decision_event(
    *,
    run_id: str,
    evaluation_id: str | None,
    decision: Literal["allow", "deny", "audit"],
    reason: str,
    policy_id: str | None,
    resource: str | None,
    span_id: str | None,
) -> ThinTraceEvent:
    """Build a ``policy_decision`` trace event."""
    p = PolicyDecisionPayload(
        decision=decision,
        policy_id=policy_id,
        resource=resource,
        reason=reason,
        span_id=span_id,
    )
    return ThinTraceEvent(
        event_type="policy_decision",
        run_id=run_id,
        evaluation_id=evaluation_id,
        timestamp=utc_iso_timestamp(),
        payload=p.model_dump(mode="json"),
    )


def build_human_approval_event(
    *,
    run_id: str,
    evaluation_id: str | None,
    approved: bool,
    approver_id: str | None,
    reason: str | None,
    span_id: str | None,
    timeout_seconds: int | None,
) -> ThinTraceEvent:
    """Build a ``human_approval`` trace event."""
    p = HumanApprovalPayload(
        approved=approved,
        approver_id=approver_id,
        reason=reason,
        span_id=span_id,
        timeout_seconds=timeout_seconds,
    )
    return ThinTraceEvent(
        event_type="human_approval",
        run_id=run_id,
        evaluation_id=evaluation_id,
        timestamp=utc_iso_timestamp(),
        payload=p.model_dump(mode="json"),
    )


class TracerConfig(BaseModel):
    """Configuration for :class:`EvalTracer`."""

    api_key: str = ""
    base_url: str = "https://app.agenteval.dev"
    evaluation_id: str | None = None
    timeout_seconds: float = 3.0
    enabled: bool = True

    @classmethod
    def from_env(cls) -> TracerConfig:
        """Load config from environment.

        If ``AGENT_EVAL_API_KEY`` is unset, returns a disabled config (never
        raises).
        """
        import os

        key = (os.environ.get("AGENT_EVAL_API_KEY") or "").strip()
        base = (os.environ.get("AGENT_EVAL_BASE_URL") or "").strip()
        eval_id = (os.environ.get("AGENT_EVAL_EVALUATION_ID") or "").strip()
        if not key:
            return cls(api_key="", enabled=False)
        return cls(
            api_key=key,
            base_url=base or "https://app.agenteval.dev",
            evaluation_id=eval_id or None,
        )
