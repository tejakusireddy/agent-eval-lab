"""Canonical Pydantic models for evaluation traces and grader outputs."""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from agent_eval_lab.evaluator.scoring import ScenarioStatus

_CANONICAL_SCORES: frozenset[float] = frozenset({0.0, 25.0, 50.0, 100.0})

_TRACE_ORIGINS: frozenset[str] = frozenset(
    {"native", "synthetic", "sdk", "otel", "langsmith"}
)


class SpanEvent(str, Enum):
    """First-class span event types (OTel-aligned naming)."""

    RUN_STARTED = "run_started"
    MODEL_CALL = "model_call"
    TOOL_CALL = "tool_call"
    TOOL_RESULT = "tool_result"
    POLICY_DECISION = "policy_decision"
    HUMAN_APPROVAL = "human_approval"
    RUN_COMPLETED = "run_completed"
    RUN_FAILED = "run_failed"


class GraderType(str, Enum):
    """Registered grader implementations."""

    RUBRIC = "rubric"
    POLICY_VIOLATION = "policy_violation"
    EXPLOIT_SUCCESS = "exploit_success"


class CalibrationState(BaseModel):
    """
    Structured calibration status attached to every GraderResult.

    Stored alongside grader outputs so the gate layer can make
    policy decisions based on calibration without re-grading.
    """

    is_calibrated: bool
    calibration_version: str = "1.0"
    calibration_checked_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )
    calibration_threshold_met: bool
    samples_seen: int = 0
    agreement_rate: float = 0.0
    min_samples_required: int = 150
    min_agreement_required: float = 0.85
    reason: str = ""

    model_config = ConfigDict(frozen=True)


class GraderResult(BaseModel):
    """Structured output from a single grader invocation."""

    grader_type: GraderType
    passed: bool
    score: float
    reasoning: str
    violations: list[str] = Field(default_factory=list)
    confidence: float = Field(
        ...,
        description="Calibration weight / agreement prior; 0.0–1.0 for future RL.",
    )
    metadata: dict[str, Any] = Field(default_factory=dict)
    calibration_state: CalibrationState | None = None

    @field_validator("score")
    @classmethod
    def validate_canonical_score(cls, value: float) -> float:
        """Restrict scores to the canonical evaluation scale."""
        if value not in _CANONICAL_SCORES:
            raise ValueError(
                f"score must be one of {sorted(_CANONICAL_SCORES)}, got {value!r}"
            )
        return value

    @field_validator("confidence")
    @classmethod
    def validate_confidence(cls, value: float) -> float:
        """Keep confidence in [0.0, 1.0]."""
        if not 0.0 <= value <= 1.0:
            raise ValueError(f"confidence must be in [0.0, 1.0], got {value!r}")
        return value


class EvalSpanModel(BaseModel):
    """In-memory representation of one scenario attempt span."""

    span_id: str
    parent_span_id: str | None = None
    trace_id: str
    event_type: SpanEvent
    scenario_id: str | None = None
    attempt: int = 1
    started_at: datetime
    completed_at: datetime | None = None
    duration_ms: int | None = None
    status: ScenarioStatus | None = None
    score: float | None = None
    reasoning: str = ""
    raw_prompt: str = ""
    raw_response: str = ""
    tags: list[str] = Field(default_factory=list)
    fail_reasons: list[str] = Field(default_factory=list)
    grader_results: list[GraderResult] = Field(default_factory=list)
    attributes: dict[str, Any] = Field(default_factory=dict)
    trace_origin: str = Field(
        default="synthetic",
        description="native | synthetic | sdk | otel | langsmith",
    )

    @field_validator("trace_origin")
    @classmethod
    def validate_trace_origin(cls, value: str) -> str:
        if value not in _TRACE_ORIGINS:
            raise ValueError(
                f"trace_origin must be one of {sorted(_TRACE_ORIGINS)}, got {value!r}"
            )
        return value

    @field_validator("score")
    @classmethod
    def validate_span_score(cls, value: float | None) -> float | None:
        """When set, score must use the canonical scale."""
        if value is None:
            return value
        if value not in _CANONICAL_SCORES:
            raise ValueError(
                f"score must be one of {sorted(_CANONICAL_SCORES)}, got {value!r}"
            )
        return value


class EvalRunModel(BaseModel):
    """In-memory representation of a full evaluation run (trace root)."""

    eval_run_id: str
    evaluation_id: str
    spec_version: str = "1.0"
    trace_id: str
    provider: str
    model: str | None = None
    scenario_ids: list[str] = Field(default_factory=list)
    status: str = "started"
    started_at: datetime
    completed_at: datetime | None = None
    total_scenarios: int = 0
    passed_count: int = 0
    failed_minor: int = 0
    failed_critical: int = 0
    safety_score: float | None = None
    spans: list[EvalSpanModel] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
