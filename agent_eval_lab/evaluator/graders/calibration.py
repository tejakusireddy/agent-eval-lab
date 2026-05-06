"""In-memory (and optional JSONL) calibration tracking for trace graders."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any

import structlog
from pydantic import BaseModel, Field

from agent_eval_lab.trace.models import GraderType

logger = structlog.get_logger(__name__)

_MIN_SAMPLES_FOR_RATE = 10


class CalibrationRecord(BaseModel):
    """A single human-labeled trace for calibration."""

    span_id: str
    grader_type: GraderType
    human_verdict: bool
    grader_verdict: bool
    grader_confidence: float
    llm_used: bool
    agreed: bool
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )


class CalibrationTracker:
    """
    Tracks grader agreement with human labels.

    Stores records in memory and optionally appends JSONL lines to
    ``CALIBRATION_LOG_PATH`` when set.
    """

    def __init__(self) -> None:
        self._records: list[CalibrationRecord] = []
        self._log_path: str | None = os.environ.get("CALIBRATION_LOG_PATH")

    def record(
        self,
        span_id: str,
        grader_type: GraderType,
        human_verdict: bool,
        grader_verdict: bool,
        grader_confidence: float,
        llm_used: bool,
    ) -> CalibrationRecord:
        """Append a calibration record and optionally persist it."""
        agreed = human_verdict == grader_verdict
        rec = CalibrationRecord(
            span_id=span_id,
            grader_type=grader_type,
            human_verdict=human_verdict,
            grader_verdict=grader_verdict,
            grader_confidence=grader_confidence,
            llm_used=llm_used,
            agreed=agreed,
        )
        self._records.append(rec)
        if self._log_path:
            try:
                with open(self._log_path, "a", encoding="utf-8") as f:
                    f.write(rec.model_dump_json() + "\n")
            except OSError as exc:
                logger.error(
                    "calibration_log_write_failed",
                    path=self._log_path,
                    error=str(exc),
                )
        return rec

    def agreement_rate(self, grader_type: GraderType | None = None) -> float:
        """
        Return agreement rate for ``grader_type``, or overall if ``None``.

        Returns ``0.0`` if fewer than ``_MIN_SAMPLES_FOR_RATE`` matching records.
        """
        subset = self._records
        if grader_type is not None:
            subset = [r for r in self._records if r.grader_type == grader_type]
        if len(subset) < _MIN_SAMPLES_FOR_RATE:
            return 0.0
        agreed_n = sum(1 for r in subset if r.agreed)
        return agreed_n / len(subset)

    def _records_for_type(self, grader_type: GraderType) -> int:
        """Return number of calibration records for one grader type."""
        return sum(1 for r in self._records if r.grader_type == grader_type)

    def is_calibrated(
        self,
        grader_type: GraderType,
        min_samples: int = 150,
        min_agreement: float = 0.85,
    ) -> tuple[bool, str]:
        """
        Return ``(calibrated, reason)``.

        ``calibrated`` is True only when there are at least ``min_samples``
        records for this grader type and agreement rate meets ``min_agreement``.
        """
        subset = [r for r in self._records if r.grader_type == grader_type]
        if len(subset) < min_samples:
            return (
                False,
                f"need at least {min_samples} labeled traces for "
                f"{grader_type.value}; have {len(subset)}",
            )
        agreed_n = sum(1 for r in subset if r.agreed)
        rate = agreed_n / len(subset)
        if rate < min_agreement:
            return (
                False,
                f"agreement rate {rate:.3f} below required {min_agreement:.2f}",
            )
        return (True, f"calibrated: agreement {rate:.3f} over {len(subset)} samples")

    def summary(self) -> dict[str, Any]:
        """Return calibration summary for all grader types."""
        by_type: dict[str, dict[str, Any]] = {}
        for gt in GraderType:
            subset = [r for r in self._records if r.grader_type == gt]
            agreed_n = sum(1 for r in subset if r.agreed)
            n = len(subset)
            rate = (agreed_n / n) if n else 0.0
            cal_ok, reason = self.is_calibrated(gt)
            by_type[gt.value] = {
                "count": n,
                "agreement_rate": rate,
                "calibrated": cal_ok,
                "calibration_reason": reason,
            }
        overall_agreed = sum(1 for r in self._records if r.agreed)
        total = len(self._records)
        by_type["_overall"] = {
            "count": total,
            "agreement_rate": (overall_agreed / total) if total else 0.0,
        }
        return by_type


calibration_tracker = CalibrationTracker()
