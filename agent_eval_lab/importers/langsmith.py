"""
Pull-based LangSmith trace importer: maps remote runs to EvalRunModel / EvalSpanModel.

Mapper-only: no LangChain runtime dependency. Never raises from public entrypoints.
"""

from __future__ import annotations

import json
import os
import secrets
import uuid
from datetime import datetime, timezone
from typing import Any

import httpx
import structlog
from pydantic import BaseModel, ConfigDict, Field, field_validator

from agent_eval_lab.evaluator.graders import default_registry
from agent_eval_lab.trace.models import EvalRunModel, EvalSpanModel, SpanEvent

logger = structlog.get_logger(__name__)

_PREVIEW_MAX = 500
_RUNS_PATHS = ("/api/v1/runs", "/runs")


def _iso_to_dt(value: str | datetime | None) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    text = str(value).strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _duration_ms(start: datetime | None, end: datetime | None) -> int | None:
    if start is None or end is None:
        return None
    delta = end - start
    ms = int(delta.total_seconds() * 1000)
    return max(0, ms)


def _truncate(text: str, max_len: int = _PREVIEW_MAX) -> str:
    if len(text) <= max_len:
        return text
    return text[:max_len]


def _coerce_dict(value: Any) -> dict[str, Any]:
    if value is None:
        return {}
    if isinstance(value, dict):
        return value
    return {}


class LangSmithConfig(BaseModel):
    """Configuration for LangSmith API access."""

    api_key: str
    project_name: str
    base_url: str = "https://api.smith.langchain.com"
    limit: int = 50
    run_types: list[str] = Field(
        default_factory=lambda: ["chain", "llm", "tool", "retriever"]
    )

    @classmethod
    def from_env(cls) -> LangSmithConfig:
        """Build config from ``LANGSMITH_API_KEY`` and ``LANGSMITH_PROJECT``."""
        key = (os.environ.get("LANGSMITH_API_KEY") or "").strip()
        project = (os.environ.get("LANGSMITH_PROJECT") or "").strip()
        return cls(api_key=key, project_name=project)


class LangSmithRun(BaseModel):
    """Validated LangSmith run shape (extra fields ignored)."""

    model_config = ConfigDict(extra="ignore")

    id: str
    name: str
    run_type: str
    inputs: dict[str, Any] = Field(default_factory=dict)
    outputs: dict[str, Any] | None = None
    error: str | None = None
    start_time: datetime
    end_time: datetime | None = None
    parent_run_id: str | None = None
    trace_id: str
    tags: list[str] = Field(default_factory=list)
    extra: dict[str, Any] = Field(default_factory=dict)

    @field_validator("inputs", "extra", mode="before")
    @classmethod
    def _inputs_dict(cls, value: Any) -> dict[str, Any]:
        return _coerce_dict(value)

    @field_validator("outputs", mode="before")
    @classmethod
    def _outputs_dict(cls, value: Any) -> dict[str, Any] | None:
        if value is None:
            return None
        return _coerce_dict(value)

    @field_validator("start_time", "end_time", mode="before")
    @classmethod
    def _parse_times(cls, value: Any) -> datetime | None:
        if value is None:
            return None
        if isinstance(value, datetime):
            return value
        return _iso_to_dt(str(value))


class LangSmithImportResult(BaseModel):
    """Result of a LangSmith import operation."""

    traces_fetched: int
    spans_created: int
    eval_runs_created: int
    errors: list[str] = Field(default_factory=list)
    eval_run_ids: list[str] = Field(default_factory=list)


def _extract_llm_previews(run: LangSmithRun) -> tuple[str, str]:
    """Return (prompt_preview, response_preview) for an LLM run."""
    prompt = ""
    messages = run.inputs.get("messages")
    if isinstance(messages, list) and messages:
        first = messages[0]
        if isinstance(first, dict):
            content = first.get("content")
            if isinstance(content, str):
                prompt = content
    if not prompt:
        p = run.inputs.get("prompt")
        if isinstance(p, str):
            prompt = p
    response = ""
    if run.outputs:
        gens = run.outputs.get("generations")
        if isinstance(gens, list) and gens:
            g0 = gens[0]
            if isinstance(g0, dict):
                t = g0.get("text")
                if isinstance(t, str):
                    response = t
        if not response:
            for key in ("output", "text", "content"):
                v = run.outputs.get(key)
                if isinstance(v, str):
                    response = v
                    break
    return _truncate(prompt), _truncate(response)


def _persist_eval_run_model(run_model: EvalRunModel) -> None:
    """Insert EvalRun + EvalSpan rows (same shape as worker ``_write_trace_to_db``)."""
    import psycopg
    from psycopg.types.json import Jsonb

    from agent_eval_lab.worker.tasks import _connect_dsn

    with psycopg.connect(_connect_dsn()) as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO "EvalRun" (
                        "id", "evaluationId", "specVersion", "traceId",
                        "provider", "model", "scenarioIds", "status",
                        "startedAt", "completedAt",
                        "totalScenarios", "passedCount", "failedMinor",
                        "failedCritical", "safetyScore", "metadata"
                    ) VALUES (
                        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                        %s, %s, %s, %s, %s, %s
                    )
                    """,
                    (
                        run_model.eval_run_id,
                        run_model.evaluation_id,
                        run_model.spec_version,
                        run_model.trace_id,
                        run_model.provider,
                        run_model.model,
                        Jsonb(run_model.scenario_ids),
                        run_model.status,
                        run_model.started_at,
                        run_model.completed_at,
                        run_model.total_scenarios,
                        run_model.passed_count,
                        run_model.failed_minor,
                        run_model.failed_critical,
                        run_model.safety_score,
                        Jsonb(run_model.metadata),
                    ),
                )
                for sp in run_model.spans:
                    span_db_id = str(uuid.uuid4())
                    grader_payload = [
                        g.model_dump(mode="json") for g in sp.grader_results
                    ]
                    cur.execute(
                        """
                        INSERT INTO "EvalSpan" (
                            "id", "evalRunId", "spanId", "parentSpanId",
                            "traceId", "eventType", "scenarioId", "attempt",
                            "startedAt", "completedAt", "durationMs",
                            "status", "score", "reasoning",
                            "rawPrompt", "rawResponse",
                            "tags", "failReasons", "graderResults", "attributes",
                            "traceOrigin"
                        ) VALUES (
                            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                        )
                        """,
                        (
                            span_db_id,
                            run_model.eval_run_id,
                            sp.span_id,
                            sp.parent_span_id,
                            sp.trace_id,
                            sp.event_type.value,
                            sp.scenario_id,
                            sp.attempt,
                            sp.started_at,
                            sp.completed_at,
                            sp.duration_ms,
                            sp.status.value if sp.status else None,
                            sp.score,
                            sp.reasoning,
                            sp.raw_prompt,
                            sp.raw_response,
                            Jsonb(sp.tags),
                            Jsonb(sp.fail_reasons),
                            Jsonb(grader_payload),
                            Jsonb(sp.attributes),
                            sp.trace_origin,
                        ),
                    )


class LangSmithImporter:
    """
    Fetches traces from LangSmith and maps them to EvalRunModel + EvalSpanModel.

    All errors are collected on :meth:`import_to_db` result; methods avoid raising.
    """

    def __init__(self, config: LangSmithConfig) -> None:
        self.config = config
        self._client = httpx.Client(
            base_url=config.base_url.rstrip("/"),
            headers={"x-api-key": config.api_key},
            timeout=30.0,
        )

    def fetch_runs(self) -> list[LangSmithRun]:
        """
        Fetch root runs from LangSmith via POST ``/runs/query``, merge and cap by ``limit``.

        Returns validated runs; malformed rows are skipped with a warning.
        """
        merged: dict[str, dict[str, Any]] = {}
        payload: Any | None = None
        last_err: str | None = None

        # TODO(LangSmith API): As of early 2025 the list endpoint is
        # POST /runs/query with a JSON body. If you get empty results:
        # 1. Verify project_name matches exactly (case-sensitive in LangSmith)
        # 2. Try removing "execution_order": 1 to fetch all runs not just roots
        # 3. Check if your LangSmith workspace uses /api/v1/runs/query
        #    instead of /runs/query (some self-hosted versions differ)
        # 4. The response shape may be a list OR {"runs": [...]} —
        #    both are handled below.
        try:
            response = self._client.post(
                "/runs/query",
                json={
                    "session_name": self.config.project_name,
                    "limit": self.config.limit,
                    "run_type": self.config.run_types,
                    "execution_order": 1,
                },
            )
            if response.status_code == 404:
                last_err = "/runs/query returned 404"
            else:
                response.raise_for_status()
                payload = response.json()
        except httpx.HTTPError as exc:
            last_err = str(exc)
            logger.warning(
                "langsmith_fetch_http_error",
                path="/runs/query",
                error=last_err,
            )
        except ValueError as exc:
            last_err = str(exc)
            logger.warning(
                "langsmith_fetch_json_error",
                path="/runs/query",
                error=last_err,
            )

        if payload is None:
            logger.warning(
                "langsmith_fetch_query_unavailable",
                error=last_err,
            )
            return []

        raw_list: list[Any]
        if isinstance(payload, list):
            raw_list = payload
        elif isinstance(payload, dict) and "runs" in payload:
            raw_list = payload["runs"] if isinstance(payload["runs"], list) else []
        else:
            raw_list = []

        for item in raw_list:
            if not isinstance(item, dict):
                continue
            rid = item.get("id")
            if not isinstance(rid, str):
                continue
            try:
                run = LangSmithRun.model_validate(item)
                merged[rid] = run.model_dump(mode="python")
            except Exception:
                logger.warning("langsmith_run_validation_skipped", run_id=rid)

        runs = [LangSmithRun.model_validate(d) for d in merged.values()]
        runs.sort(key=lambda r: r.start_time)
        if len(runs) > self.config.limit:
            runs = runs[: self.config.limit]
        return runs

    def group_by_trace(self, runs: list[LangSmithRun]) -> dict[str, list[LangSmithRun]]:
        """Group runs by ``trace_id``."""
        out: dict[str, list[LangSmithRun]] = {}
        for run in runs:
            out.setdefault(run.trace_id, []).append(run)
        for tid in out:
            out[tid].sort(key=lambda r: r.start_time)
        return out

    def map_trace_to_eval_run(
        self,
        trace_id: str,
        runs: list[LangSmithRun],
        evaluation_id: str,
    ) -> tuple[EvalRunModel, list[EvalSpanModel]]:
        """
        Map one LangSmith trace tree to an EvalRun and ordered EvalSpan list.

        Span ``parent_span_id`` links to the mapped LangSmith parent's span_id where known.
        """
        ls_to_span: dict[str, str] = {}
        spans: list[EvalSpanModel] = []

        def new_span_id() -> str:
            return secrets.token_hex(8)

        def parent_for(ls_run: LangSmithRun) -> str | None:
            if not ls_run.parent_run_id:
                return None
            return ls_to_span.get(ls_run.parent_run_id)

        root_chain = next(
            (
                r
                for r in runs
                if r.run_type == "chain" and r.parent_run_id is None
            ),
            None,
        )

        if root_chain:
            sid_start = new_span_id()
            ls_to_span[root_chain.id] = sid_start
            spans.append(
                EvalSpanModel(
                    span_id=sid_start,
                    parent_span_id=None,
                    trace_id=trace_id,
                    event_type=SpanEvent.RUN_STARTED,
                    scenario_id=None,
                    attempt=1,
                    started_at=root_chain.start_time,
                    completed_at=root_chain.start_time,
                    duration_ms=0,
                    status=None,
                    score=None,
                    reasoning="",
                    raw_prompt="",
                    raw_response="",
                    tags=list(root_chain.tags),
                    attributes={
                        "langsmith_run_id": root_chain.id,
                        "langsmith_name": root_chain.name,
                        **root_chain.extra,
                    },
                    trace_origin="langsmith",
                )
            )
            end_evt = (
                SpanEvent.RUN_FAILED if root_chain.error else SpanEvent.RUN_COMPLETED
            )
            sid_end = new_span_id()
            spans.append(
                EvalSpanModel(
                    span_id=sid_end,
                    parent_span_id=None,
                    trace_id=trace_id,
                    event_type=end_evt,
                    scenario_id=None,
                    attempt=1,
                    started_at=root_chain.end_time or root_chain.start_time,
                    completed_at=root_chain.end_time or root_chain.start_time,
                    duration_ms=_duration_ms(
                        root_chain.start_time, root_chain.end_time
                    ),
                    status=None,
                    score=None,
                    reasoning=root_chain.error or "",
                    raw_prompt="",
                    raw_response="",
                    tags=list(root_chain.tags),
                    attributes={
                        "langsmith_run_id": root_chain.id,
                        "langsmith_name": root_chain.name,
                        **root_chain.extra,
                    },
                    trace_origin="langsmith",
                )
            )

        first_llm_name: str | None = None
        for run in runs:
            rt = run.run_type
            if root_chain and run.id == root_chain.id:
                continue

            if rt == "llm":
                sid = new_span_id()
                ls_to_span[run.id] = sid
                pr, rr = _extract_llm_previews(run)
                if first_llm_name is None:
                    first_llm_name = run.name
                spans.append(
                    EvalSpanModel(
                        span_id=sid,
                        parent_span_id=parent_for(run),
                        trace_id=trace_id,
                        event_type=SpanEvent.MODEL_CALL,
                        scenario_id=None,
                        attempt=1,
                        started_at=run.start_time,
                        completed_at=run.end_time,
                        duration_ms=_duration_ms(run.start_time, run.end_time),
                        status=None,
                        score=None,
                        reasoning="",
                        raw_prompt=pr,
                        raw_response=rr,
                        tags=list(run.tags),
                        attributes={
                            "langsmith_run_id": run.id,
                            "langsmith_name": run.name,
                            **run.extra,
                        },
                        trace_origin="langsmith",
                    )
                )
            elif rt == "tool":
                sid_call = new_span_id()
                ls_to_span[run.id] = sid_call
                spans.append(
                    EvalSpanModel(
                        span_id=sid_call,
                        parent_span_id=parent_for(run),
                        trace_id=trace_id,
                        event_type=SpanEvent.TOOL_CALL,
                        scenario_id=None,
                        attempt=1,
                        started_at=run.start_time,
                        completed_at=run.start_time,
                        duration_ms=0,
                        status=None,
                        score=None,
                        reasoning="",
                        raw_prompt="",
                        raw_response="",
                        tags=list(run.tags),
                        attributes={
                            "langsmith_run_id": run.id,
                            "tool_name": run.name,
                            **run.extra,
                        },
                        trace_origin="langsmith",
                    )
                )
                out_preview = (
                    _truncate(json.dumps(run.outputs, default=str))
                    if run.outputs
                    else None
                )
                sid_res = new_span_id()
                spans.append(
                    EvalSpanModel(
                        span_id=sid_res,
                        parent_span_id=sid_call,
                        trace_id=trace_id,
                        event_type=SpanEvent.TOOL_RESULT,
                        scenario_id=None,
                        attempt=1,
                        started_at=run.end_time or run.start_time,
                        completed_at=run.end_time or run.start_time,
                        duration_ms=_duration_ms(run.start_time, run.end_time),
                        status=None,
                        score=None,
                        reasoning="",
                        raw_prompt="",
                        raw_response=out_preview or "",
                        tags=list(run.tags),
                        attributes={
                            "langsmith_run_id": run.id,
                            "tool_name": run.name,
                            "success": run.error is None,
                            "error": run.error,
                            **run.extra,
                        },
                        trace_origin="langsmith",
                    )
                )
            elif rt == "retriever":
                sid = new_span_id()
                ls_to_span[run.id] = sid
                spans.append(
                    EvalSpanModel(
                        span_id=sid,
                        parent_span_id=parent_for(run),
                        trace_id=trace_id,
                        event_type=SpanEvent.TOOL_CALL,
                        scenario_id=None,
                        attempt=1,
                        started_at=run.start_time,
                        completed_at=run.end_time or run.start_time,
                        duration_ms=_duration_ms(run.start_time, run.end_time),
                        status=None,
                        score=None,
                        reasoning="",
                        raw_prompt="",
                        raw_response="",
                        tags=list(run.tags),
                        attributes={
                            "langsmith_run_id": run.id,
                            "tool_name": f"retriever:{run.name}",
                            **run.extra,
                        },
                        trace_origin="langsmith",
                    )
                )
            elif rt == "chain" and run.parent_run_id is not None:
                sid = new_span_id()
                ls_to_span[run.id] = sid
                spans.append(
                    EvalSpanModel(
                        span_id=sid,
                        parent_span_id=parent_for(run),
                        trace_id=trace_id,
                        event_type=SpanEvent.MODEL_CALL,
                        scenario_id=None,
                        attempt=1,
                        started_at=run.start_time,
                        completed_at=run.end_time,
                        duration_ms=_duration_ms(run.start_time, run.end_time),
                        status=None,
                        score=None,
                        reasoning="",
                        raw_prompt=_truncate(
                            json.dumps(run.inputs, default=str)
                        ),
                        raw_response=_truncate(
                            json.dumps(run.outputs or {}, default=str)
                        ),
                        tags=list(run.tags),
                        attributes={
                            "langsmith_run_id": run.id,
                            "langsmith_name": run.name,
                            "mapped_as": "sub_chain",
                            **run.extra,
                        },
                        trace_origin="langsmith",
                    )
                )

        if not spans and runs:
            run0 = runs[0]
            sid = new_span_id()
            spans.append(
                EvalSpanModel(
                    span_id=sid,
                    parent_span_id=None,
                    trace_id=trace_id,
                    event_type=SpanEvent.RUN_STARTED,
                    scenario_id=None,
                    attempt=1,
                    started_at=run0.start_time,
                    completed_at=run0.start_time,
                    duration_ms=0,
                    status=None,
                    score=None,
                    reasoning="",
                    raw_prompt="",
                    raw_response="",
                    tags=list(run0.tags),
                    attributes={"synthetic": True, "langsmith_run_id": run0.id},
                    trace_origin="langsmith",
                )
            )

        started = min(s.started_at for s in spans) if spans else datetime.now(timezone.utc)
        ended = max(
            (s.completed_at or s.started_at for s in spans),
            default=started,
        )

        run_model = EvalRunModel(
            eval_run_id=str(uuid.uuid4()),
            evaluation_id=evaluation_id,
            spec_version="1.0",
            trace_id=trace_id,
            provider="langsmith_import",
            model=first_llm_name,
            scenario_ids=[],
            status="completed",
            started_at=started,
            completed_at=ended,
            total_scenarios=0,
            passed_count=0,
            failed_minor=0,
            failed_critical=0,
            safety_score=None,
            spans=[],
            metadata={
                "spec_version": "1.0",
                "langsmith_project": self.config.project_name,
                "source": "langsmith_import",
            },
        )
        return run_model, spans

    def import_to_db(self, evaluation_id: str) -> LangSmithImportResult:
        """
        Full import: fetch, map traces, grade spans, persist each EvalRun.

        Never raises; failures append to ``result.errors``.
        """
        result = LangSmithImportResult(
            traces_fetched=0,
            spans_created=0,
            eval_runs_created=0,
        )
        try:
            runs = self.fetch_runs()
        except Exception as exc:
            logger.error("langsmith_fetch_failed", exc_info=True)
            result.errors.append(f"fetch_runs: {exc}")
            return result

        if not runs:
            result.errors.append("No runs returned from LangSmith")
            return result

        grouped = self.group_by_trace(runs)
        result.traces_fetched = len(grouped)

        for trace_id, trace_runs in grouped.items():
            try:
                run_model, spans = self.map_trace_to_eval_run(
                    trace_id, trace_runs, evaluation_id
                )
                graded: list[EvalSpanModel] = []
                for sp in spans:
                    try:
                        graded_results = default_registry.grade_span(sp)
                    except Exception:
                        logger.warning(
                            "langsmith_span_grade_failed",
                            span_id=sp.span_id,
                            exc_info=True,
                        )
                        graded_results = []
                    graded.append(
                        sp.model_copy(update={"grader_results": graded_results})
                    )
                final_run = run_model.model_copy(update={"spans": graded})
                _persist_eval_run_model(final_run)
                result.eval_run_ids.append(final_run.eval_run_id)
                result.eval_runs_created += 1
                result.spans_created += len(graded)
            except Exception as exc:
                logger.error(
                    "langsmith_trace_import_failed",
                    trace_id=trace_id,
                    exc_info=True,
                )
                result.errors.append(f"trace {trace_id}: {exc}")

        return result

    def close(self) -> None:
        """Close the HTTP client."""
        self._client.close()

    def __enter__(self) -> LangSmithImporter:
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()
