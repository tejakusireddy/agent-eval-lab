"""Abstract grader interface and registry for trace-level scoring."""

from __future__ import annotations

import abc
from datetime import datetime, timezone
import structlog

from agent_eval_lab.trace.models import (
    CalibrationState,
    EvalSpanModel,
    GraderResult,
    GraderType,
    SpanEvent,
)

logger = structlog.get_logger(__name__)

RULE_CONFIDENCE_THRESHOLD: float = 0.85


class GraderError(Exception):
    """Raised when a grader fails unrecoverably."""

    pass


class BaseGrader(abc.ABC):
    """
    Abstract base for all trace-level graders.

    Graders consume an EvalSpanModel and return a GraderResult.
    They must not mutate the span. They must be stateless.
    Calibration: grader agreement rate must exceed 85% on held-out
    labeled set before being used in a release gate decision.
    """

    @property
    @abc.abstractmethod
    def grader_type(self) -> GraderType:
        """Discriminator for registry lookup."""

    @abc.abstractmethod
    def grade(self, span: EvalSpanModel) -> GraderResult:
        """
        Grade a single span.

        Args:
            span: The span to grade

        Returns:
            GraderResult with score, reasoning, violations, confidence

        Raises:
            GraderError: If grading fails unrecoverably
        """

    def can_grade(self, span: EvalSpanModel) -> bool:
        """
        Return True if this grader applies to the given span.

        Default: grader applies to run_completed and run_failed events.
        Override in subclasses for graders that apply to other event types.
        """
        return span.event_type in (
            SpanEvent.RUN_COMPLETED,
            SpanEvent.RUN_FAILED,
        )


class GraderRegistry:
    """
    Registry of available graders.
    Graders are registered by type and looked up by type.
    """

    def __init__(self) -> None:
        """Initialize an empty registry."""
        self._graders: dict[GraderType, BaseGrader] = {}

    def register(self, grader: BaseGrader) -> None:
        """Register a grader instance, replacing any existing grader of the same type."""
        self._graders[grader.grader_type] = grader

    def get(self, grader_type: GraderType) -> BaseGrader | None:
        """Return the grader for ``grader_type``, or None if missing."""
        return self._graders.get(grader_type)

    def all(self) -> list[BaseGrader]:
        """Return all registered graders."""
        return list(self._graders.values())

    def grade_span(self, span: EvalSpanModel) -> list[GraderResult]:
        """
        Run all registered graders that can_grade() this span.

        Errors from individual graders are caught and logged — one grader
        failure must not stop others.

        Returns:
            List of GraderResult from graders that completed successfully.
        """
        results: list[GraderResult] = []
        for grader in self.all():
            if not grader.can_grade(span):
                continue
            try:
                results.append(grader.grade(span))
            except Exception:
                logger.error(
                    "grader_failed",
                    grader_type=grader.grader_type.value,
                    span_id=span.span_id,
                    exc_info=True,
                )
        return results

    def grade_span_with_calibration_check(
        self,
        span: EvalSpanModel,
        require_calibration: bool = False,
    ) -> list[GraderResult]:
        """
        Like :meth:`grade_span` but records calibration status on each result.

        If ``require_calibration`` is True, graders that fail
        :meth:`CalibrationTracker.is_calibrated` are skipped and a warning is logged.

        When ``require_calibration`` is False, all applicable graders still run and
        each result gets a structured ``calibration_state``.
        """
        from agent_eval_lab.evaluator.graders.calibration import calibration_tracker

        results: list[GraderResult] = []
        for grader in self.all():
            if not grader.can_grade(span):
                continue
            calibrated, reason = calibration_tracker.is_calibrated(grader.grader_type)
            if require_calibration and not calibrated:
                logger.warning(
                    "grader_skipped_not_calibrated",
                    grader_type=grader.grader_type.value,
                    reason=reason,
                )
                continue
            try:
                result = grader.grade(span)
                calibration_state = CalibrationState(
                    is_calibrated=calibrated,
                    calibration_checked_at=datetime.now(timezone.utc),
                    calibration_threshold_met=calibrated,
                    samples_seen=calibration_tracker._records_for_type(
                        grader.grader_type
                    ),
                    agreement_rate=calibration_tracker.agreement_rate(
                        grader.grader_type
                    ),
                    reason=reason,
                )
                cleaned_meta = {
                    k: v
                    for k, v in result.metadata.items()
                    if k not in ("calibrated", "calibration_reason")
                }
                results.append(
                    result.model_copy(
                        update={
                            "calibration_state": calibration_state,
                            "metadata": cleaned_meta,
                        }
                    )
                )
            except Exception:
                logger.error(
                    "grader_failed",
                    grader_type=grader.grader_type.value,
                    span_id=span.span_id,
                    exc_info=True,
                )
        return results
