"""
OTLP JSON exporter for EvalSpanModel — optional forward to collectors (Jaeger, Tempo, etc.).

Uses httpx only; no OpenTelemetry SDK required for core installs.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any

import httpx
import structlog
from pydantic import BaseModel, Field

from agent_eval_lab.evaluator.scoring import ScenarioStatus
from agent_eval_lab.trace.models import (
    EvalRunModel,
    EvalSpanModel,
    GraderResult,
    SpanEvent,
)

logger = structlog.get_logger(__name__)

_CANONICAL_SCORES = frozenset({0.0, 25.0, 50.0, 100.0})


class OtelExporterConfig(BaseModel):
    """Configuration for OTLP HTTP export."""

    endpoint: str = ""
    headers: dict[str, str] = Field(default_factory=dict)
    service_name: str = "agent-eval-lab"
    enabled: bool = True
    timeout_seconds: float = 5.0

    @classmethod
    def from_env(cls) -> "OtelExporterConfig":
        """Load from ``OTEL_EXPORTER_OTLP_ENDPOINT`` and ``OTEL_EXPORTER_OTLP_HEADERS``."""
        endpoint = (os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT") or "").strip()
        raw_headers = (os.environ.get("OTEL_EXPORTER_OTLP_HEADERS") or "").strip()
        headers: dict[str, str] = {}
        if raw_headers:
            for part in raw_headers.split(","):
                part = part.strip()
                if "=" in part:
                    k, v = part.split("=", 1)
                    headers[k.strip()] = v.strip()
        if not endpoint:
            return cls(enabled=False, endpoint="")
        return cls(endpoint=endpoint, headers=headers, enabled=True)


def _date_to_nanos(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    sec = dt.timestamp()
    return str(int(sec * 1_000_000_000))


def _flatten_otel_attributes(
    span: EvalSpanModel,
) -> list[dict[str, Any]]:
    attrs: list[dict[str, Any]] = []
    if span.scenario_id:
        attrs.append(
            {"key": "scenario_id", "value": {"stringValue": span.scenario_id}}
        )
    if span.score is not None:
        attrs.append(
            {"key": "score", "value": {"stringValue": str(span.score)}}
        )
    if span.reasoning:
        attrs.append(
            {"key": "reasoning", "value": {"stringValue": span.reasoning}}
        )
    attrs.append(
        {
            "key": "tags",
            "value": {"stringValue": json.dumps(span.tags)},
        }
    )
    attrs.append(
        {
            "key": "fail_reasons",
            "value": {"stringValue": json.dumps(span.fail_reasons)},
        }
    )
    grader_dump = [g.model_dump(mode="json") for g in span.grader_results]
    attrs.append(
        {
            "key": "grader_results",
            "value": {"stringValue": json.dumps(grader_dump)},
        }
    )
    if span.status is not None:
        attrs.append(
            {
                "key": "eval.status",
                "value": {"stringValue": span.status.value},
            }
        )
    return attrs


class OtelExporter:
    """
    Export ``EvalSpanModel`` instances as OTLP JSON to an HTTP endpoint.

    Fire-and-forget: :meth:`export` never raises; failures are logged.
    """

    def __init__(self, config: OtelExporterConfig | None = None) -> None:
        self.config = config or OtelExporterConfig.from_env()

    def span_to_otlp_dict(self, span: EvalSpanModel) -> dict[str, Any]:
        """
        Convert one span to OTLP JSON span object (same mapping as TypeScript
        ``evalSpanToOtelSpan``).
        """
        status_code = 0
        status_msg: str | None = None
        if span.status == ScenarioStatus.PASS:
            status_code = 1
        elif span.status == ScenarioStatus.FAIL_CRITICAL:
            status_code = 2
        elif span.status == ScenarioStatus.FAIL_MINOR:
            status_code = 1
            status_msg = "FAIL_MINOR"

        status_obj: dict[str, Any] = {"code": status_code}
        if status_msg:
            status_obj["message"] = status_msg

        out: dict[str, Any] = {
            "traceId": span.trace_id,
            "spanId": span.span_id,
            "name": span.event_type.value,
            "kind": 1,
            "startTimeUnixNano": _date_to_nanos(span.started_at),
            "attributes": _flatten_otel_attributes(span),
            "status": status_obj,
            "events": [],
        }
        if span.parent_span_id:
            out["parentSpanId"] = span.parent_span_id
        if span.completed_at is not None:
            out["endTimeUnixNano"] = _date_to_nanos(span.completed_at)
        return out

    def build_otlp_payload(
        self,
        spans: list[EvalSpanModel],
    ) -> dict[str, Any]:
        """Build full OTLP JSON payload (``resourceSpans``) from spans."""
        otel_spans = [self.span_to_otlp_dict(s) for s in spans]
        return {
            "resourceSpans": [
                {
                    "resource": {
                        "attributes": [
                            {
                                "key": "service.name",
                                "value": {
                                    "stringValue": self.config.service_name,
                                },
                            }
                        ]
                    },
                    "scopeSpans": [
                        {
                            "scope": {"name": "agent_eval_lab"},
                            "spans": otel_spans,
                        }
                    ],
                }
            ]
        }

    def export(
        self,
        spans: list[EvalSpanModel],
        _eval_run: EvalRunModel | None = None,
    ) -> bool:
        """
        POST OTLP JSON to the configured endpoint.

        ``_eval_run`` is reserved for future resource attributes.

        Returns:
            ``True`` on HTTP success, ``False`` otherwise (including disabled).
        """
        if not self.config.enabled or not self.config.endpoint:
            return False
        payload = self.build_otlp_payload(spans)
        try:
            with httpx.Client(timeout=self.config.timeout_seconds) as client:
                response = client.post(
                    self.config.endpoint,
                    json=payload,
                    headers={
                        "Content-Type": "application/json",
                        **self.config.headers,
                    },
                )
                response.raise_for_status()
            logger.info(
                "otel_export_success",
                spans=len(spans),
                endpoint=self.config.endpoint,
            )
            return True
        except Exception:
            logger.error(
                "otel_export_failed",
                endpoint=self.config.endpoint,
                exc_info=True,
            )
            return False


def fetch_eval_spans_for_evaluation(evaluation_id: str) -> list[EvalSpanModel]:
    """
    Load persisted EvalSpan rows for an evaluation as ``EvalSpanModel`` list.

    Used after :func:`agent_eval_lab.worker.tasks._write_trace_to_db` to rebuild
    spans for OTLP export without duplicating runner logic.
    """
    import psycopg
    from psycopg.rows import dict_row

    from agent_eval_lab.worker.tasks import _connect_dsn

    out: list[EvalSpanModel] = []
    with psycopg.connect(_connect_dsn()) as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                """
                SELECT s."spanId", s."parentSpanId", s."traceId", s."eventType",
                       s."scenarioId", s."attempt", s."startedAt", s."completedAt",
                       s."durationMs", s."status", s."score", s."reasoning",
                       s."rawPrompt", s."rawResponse", s."tags", s."failReasons",
                       s."graderResults", s."attributes", s."traceOrigin"
                FROM "EvalSpan" s
                INNER JOIN "EvalRun" r ON s."evalRunId" = r.id
                WHERE r."evaluationId" = %s
                ORDER BY s."startedAt" ASC
                """,
                (evaluation_id,),
            )
            rows = cur.fetchall()

    for row in rows:
        raw_event = str(row["eventType"])
        try:
            event_type = SpanEvent(raw_event)
        except ValueError:
            event_type = SpanEvent.MODEL_CALL

        st_raw = row["status"]
        status: ScenarioStatus | None = None
        if st_raw:
            try:
                status = ScenarioStatus(str(st_raw))
            except ValueError:
                status = None

        tags: list[str] = []
        if row["tags"] is not None:
            if isinstance(row["tags"], list):
                tags = [str(t) for t in row["tags"]]
            elif isinstance(row["tags"], str):
                try:
                    parsed = json.loads(row["tags"])
                    if isinstance(parsed, list):
                        tags = [str(x) for x in parsed]
                except json.JSONDecodeError:
                    tags = []

        fail_reasons: list[str] = []
        if row["failReasons"] is not None:
            if isinstance(row["failReasons"], list):
                fail_reasons = [str(x) for x in row["failReasons"]]
            elif isinstance(row["failReasons"], str):
                try:
                    p = json.loads(row["failReasons"])
                    if isinstance(p, list):
                        fail_reasons = [str(x) for x in p]
                except json.JSONDecodeError:
                    fail_reasons = [row["failReasons"]]

        grader_results: list[GraderResult] = []
        gr = row["graderResults"]
        if gr is not None:
            raw_list = gr if isinstance(gr, list) else json.loads(gr) if isinstance(gr, str) else []
            for item in raw_list:
                if isinstance(item, dict):
                    try:
                        grader_results.append(GraderResult.model_validate(item))
                    except Exception:
                        continue

        attrs: dict[str, Any] = {}
        if row["attributes"] is not None:
            if isinstance(row["attributes"], dict):
                attrs = dict(row["attributes"])
            elif isinstance(row["attributes"], str):
                try:
                    parsed_a = json.loads(row["attributes"])
                    if isinstance(parsed_a, dict):
                        attrs = parsed_a
                except json.JSONDecodeError:
                    attrs = {}

        score = row["score"]
        score_f: float | None = float(score) if score is not None else None
        if score_f is not None and score_f not in _CANONICAL_SCORES:
            score_f = None

        to_raw = row.get("traceOrigin")
        trace_origin_str = (
            str(to_raw)
            if to_raw is not None and str(to_raw).strip() != ""
            else "synthetic"
        )
        _origins = frozenset(
            {"native", "synthetic", "sdk", "otel", "langsmith"}
        )
        if trace_origin_str not in _origins:
            trace_origin_str = "synthetic"

        out.append(
            EvalSpanModel(
                span_id=str(row["spanId"]),
                parent_span_id=row["parentSpanId"],
                trace_id=str(row["traceId"]),
                event_type=event_type,
                scenario_id=row["scenarioId"],
                attempt=int(row["attempt"] or 1),
                started_at=row["startedAt"],
                completed_at=row["completedAt"],
                duration_ms=row["durationMs"],
                status=status,
                score=score_f,
                reasoning=row["reasoning"] or "",
                raw_prompt=row["rawPrompt"] or "",
                raw_response=row["rawResponse"] or "",
                tags=tags,
                fail_reasons=fail_reasons,
                grader_results=grader_results,
                attributes=attrs,
                trace_origin=trace_origin_str,
            )
        )

    return out
