"""Celery tasks for running evaluations and persisting results."""

from __future__ import annotations

import asyncio
import json
import os
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import structlog
from celery import Task

from agent_eval_lab.errors import ConfigError, ProviderError
from agent_eval_lab.evaluator.graders import default_registry
from agent_eval_lab.evaluator.scoring import ScenarioStatus
from agent_eval_lab.runner.core import run_evaluation
from agent_eval_lab.scenarios.base import ScenarioResult
from agent_eval_lab.storage import get_storage_backend
from agent_eval_lab.trace.models import EvalRunModel, EvalSpanModel, SpanEvent
from agent_eval_lab.worker.celery_app import app

logger = structlog.get_logger(__name__)

_MAX_TASK_RETRIES = 3


def run_evaluation_from_config_dict(
    config: dict[str, Any],
    scenario_ids: list[str],
    scenarios_dir: str,
) -> dict[str, Any]:
    """
    Run ``run_evaluation`` using the same field mapping as ``runner.run.main``.

    Args:
        config: Sanitized evaluation configuration (JSON-serializable).
        scenario_ids: Scenario identifiers to execute.
        scenarios_dir: Absolute or relative path to scenario YAML root.

    Returns:
        Result dict from ``run_evaluation`` (results, summary, reports).
    """
    scenarios_path = Path(scenarios_dir)
    provider = config.get("provider", "openai")
    model = config.get("model", "gpt-4o-mini")
    temperature = float(config.get("temperature", 0.0))
    max_tokens = int(config.get("max_tokens", 512))
    max_concurrency = int(config.get("max_concurrency", 3))
    timeout_seconds = float(config.get("timeout_seconds", 30.0))
    max_retries = int(config.get("max_retries", 3))
    base_url = config.get("base_url")
    http_agent_base_url = config.get("http_agent_base_url")
    http_agent_config = config.get("http_agent_config")
    if not isinstance(http_agent_config, dict):
        http_agent_config = None

    raw_tool_env = config.get("tool_env_url")
    tool_env_url: str | None
    if isinstance(raw_tool_env, str) and raw_tool_env.strip():
        tool_env_url = raw_tool_env.strip()
    else:
        env_te = os.environ.get("TOOL_ENV_URL")
        tool_env_url = (
            env_te.strip() if isinstance(env_te, str) and env_te.strip() else None
        )

    raw_token = config.get("tool_env_session_token")
    tool_env_session_token: str | None
    if isinstance(raw_token, str) and raw_token.strip():
        tool_env_session_token = raw_token.strip()
    else:
        env_tok = os.environ.get("SESSION_TOKEN")
        tool_env_session_token = (
            env_tok.strip() if isinstance(env_tok, str) and env_tok.strip() else None
        )

    max_steps = int(config.get("max_steps", 10))

    raw_defense = config.get("defense_config")
    defense_config: dict[str, Any] | None = (
        raw_defense if isinstance(raw_defense, dict) else None
    )

    return asyncio.run(
        run_evaluation(
            scenario_ids=scenario_ids,
            scenarios_dir=scenarios_path,
            provider=str(provider),
            model=str(model),
            temperature=temperature,
            max_tokens=max_tokens,
            max_concurrency=max_concurrency,
            timeout_seconds=timeout_seconds,
            max_retries=max_retries,
            base_url=base_url if isinstance(base_url, str) else None,
            http_agent_base_url=(
                http_agent_base_url
                if isinstance(http_agent_base_url, str)
                else None
            ),
            http_agent_config=http_agent_config,
            logger=None,
            tool_env_url=tool_env_url,
            tool_env_session_token=tool_env_session_token,
            max_steps=max_steps,
            defense_config=defense_config,
        )
    )


def _connect_dsn() -> str:
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        raise ConfigError("DATABASE_URL is not set")
    return dsn


def _evaluation_status(evaluation_id: str) -> str | None:
    import psycopg

    with psycopg.connect(_connect_dsn()) as conn:
        with conn.cursor() as cur:
            cur.execute(
                'SELECT status FROM "Evaluation" WHERE id = %s',
                (evaluation_id,),
            )
            row = cur.fetchone()
            return str(row[0]) if row else None


def _write_running(evaluation_id: str, attempt: int) -> None:
    import psycopg

    with psycopg.connect(_connect_dsn()) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE "Evaluation"
                SET status = %s, "errorMessage" = %s
                WHERE id = %s
                """,
                ("running", f"celery_attempt={attempt}", evaluation_id),
            )
        conn.commit()


def _write_completed(
    evaluation_id: str,
    safety_score: float,
    report_html: str,
    report_json: Any,
    report_markdown: str,
) -> None:
    import psycopg
    from psycopg.types.json import Jsonb

    with psycopg.connect(_connect_dsn()) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE "Evaluation"
                SET status = %s,
                    "safetyScore" = %s,
                    "reportHtml" = %s,
                    "reportJson" = %s,
                    "reportMarkdown" = %s,
                    "completedAt" = %s,
                    "errorMessage" = NULL
                WHERE id = %s
                """,
                (
                    "completed",
                    safety_score,
                    report_html,
                    Jsonb(report_json),
                    report_markdown,
                    datetime.now(UTC),
                    evaluation_id,
                ),
            )
        conn.commit()


def _write_failed(evaluation_id: str, message: str) -> None:
    import psycopg

    with psycopg.connect(_connect_dsn()) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE "Evaluation"
                SET status = %s,
                    "errorMessage" = %s,
                    "completedAt" = %s
                WHERE id = %s
                """,
                ("failed", message, datetime.now(UTC), evaluation_id),
            )
        conn.commit()


def _parse_report_json(raw_json: str | dict[str, Any]) -> Any:
    if isinstance(raw_json, str):
        return json.loads(raw_json)
    return raw_json


def _store_artifacts(
    evaluation_id: str,
    report_html: str,
    report_markdown: str,
    report_json_str: str,
) -> dict[str, str]:
    """
    Store evaluation artifacts to configured backend.

    Returns dict of artifact references (never raises —
    storage failure is non-fatal, returns empty dict).
    """
    try:
        storage = get_storage_backend()
    except Exception:
        logger.error(
            "artifact_storage_backend_failed",
            evaluation_id=evaluation_id,
            exc_info=True,
        )
        return {}
    refs: dict[str, str] = {}
    artifacts: list[tuple[str, bytes, str]] = [
        (
            f"{evaluation_id}/reports/report.html",
            report_html.encode("utf-8"),
            "text/html",
        ),
        (
            f"{evaluation_id}/reports/report.md",
            report_markdown.encode("utf-8"),
            "text/markdown",
        ),
        (
            f"{evaluation_id}/reports/report.json",
            report_json_str.encode("utf-8"),
            "application/json",
        ),
    ]
    for path, data, content_type in artifacts:
        try:
            ref = storage.put(
                path,
                data,
                content_type,
                metadata={"evaluation_id": evaluation_id},
            )
            refs[path] = ref
        except Exception:
            logger.error(
                "artifact_storage_failed",
                path=path,
                evaluation_id=evaluation_id,
                exc_info=True,
            )
    return refs


def _span_event_for_status(status: ScenarioStatus) -> SpanEvent:
    """Map scenario outcome to a first-class span event type."""
    if status == ScenarioStatus.FAIL_CRITICAL:
        return SpanEvent.RUN_FAILED
    return SpanEvent.RUN_COMPLETED


def _write_trace_to_db(
    evaluation_id: str,
    result: dict[str, Any],
    config: dict[str, Any],
    scenario_ids: list[str],
) -> None:
    """
    Persist OTel-aligned EvalRun / EvalSpan rows and grader outputs.

    Failures are logged and never propagated (trace write is best-effort).
    """
    import psycopg
    from psycopg.types.json import Jsonb

    try:
        summary = result.get("summary", {})
        provider = str(config.get("provider", "openai"))
        model = config.get("model")
        model_str = str(model) if isinstance(model, str) else None

        eval_run_id = str(uuid.uuid4())
        run_completed_at = datetime.now(UTC)

        native_raw = result.get("spans", [])
        spans_out: list[EvalSpanModel] = []
        trace_id: str

        if isinstance(native_raw, list) and native_raw:
            logger.info(
                "using_native_spans",
                evaluation_id=evaluation_id,
                count=len(native_raw),
            )
            for item in native_raw:
                if not isinstance(item, dict):
                    continue
                try:
                    spans_out.append(EvalSpanModel.model_validate(item))
                except Exception:
                    logger.warning(
                        "native_span_validation_skipped",
                        evaluation_id=evaluation_id,
                        exc_info=True,
                    )
            if spans_out:
                trace_id = spans_out[0].trace_id
            else:
                trace_id = secrets.token_hex(16)
                logger.info(
                    "native_spans_empty_after_validation",
                    evaluation_id=evaluation_id,
                )
        else:
            logger.info(
                "falling_back_to_synthetic_spans",
                evaluation_id=evaluation_id,
            )
            trace_id = secrets.token_hex(16)
            for row in result.get("results", []):
                if not isinstance(row, dict):
                    continue
                sr = ScenarioResult.model_validate(row)
                duration_raw = sr.metadata.get("execution_time_ms")
                duration_ms: int | None
                if isinstance(duration_raw, (int, float)):
                    duration_ms = int(duration_raw)
                else:
                    duration_ms = None
                span_completed_at = run_completed_at
                span_started_at = (
                    span_completed_at - timedelta(milliseconds=duration_ms)
                    if duration_ms is not None
                    else span_completed_at
                )

                span = EvalSpanModel(
                    span_id=secrets.token_hex(8),
                    parent_span_id=None,
                    trace_id=trace_id,
                    event_type=_span_event_for_status(sr.status),
                    scenario_id=sr.scenario_id,
                    attempt=int(sr.metadata.get("attempt", 1)),
                    started_at=span_started_at,
                    completed_at=span_completed_at,
                    duration_ms=duration_ms,
                    status=sr.status,
                    score=sr.score,
                    reasoning=sr.reasoning,
                    raw_prompt=sr.raw_prompt,
                    raw_response=sr.raw_response,
                    tags=list(sr.tags),
                    fail_reasons=list(sr.fail_reasons),
                    attributes=dict(sr.metadata),
                    trace_origin="synthetic",
                )
                graded = default_registry.grade_span_with_calibration_check(
                    span, require_calibration=False
                )
                spans_out.append(span.model_copy(update={"grader_results": graded}))

        run_started_at = (
            min(s.started_at for s in spans_out)
            if spans_out
            else run_completed_at
        )

        run_model = EvalRunModel(
            eval_run_id=eval_run_id,
            evaluation_id=evaluation_id,
            spec_version="1.0",
            trace_id=trace_id,
            provider=provider,
            model=model_str,
            scenario_ids=list(scenario_ids),
            status="completed",
            started_at=run_started_at,
            completed_at=run_completed_at,
            total_scenarios=int(summary.get("total", 0)),
            passed_count=int(summary.get("passed", 0)),
            failed_minor=int(summary.get("failed_minor", 0)),
            failed_critical=int(summary.get("failed_critical", 0)),
            safety_score=(
                float(summary["safety_score"])
                if summary.get("safety_score") is not None
                else None
            ),
            spans=spans_out,
            metadata={"spec_version": "1.0"},
        )

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

        logger.info(
            "trace_persisted",
            evaluation_id=evaluation_id,
            eval_run_id=eval_run_id,
            trace_id=trace_id,
            span_count=len(spans_out),
        )
    except Exception:
        logger.error(
            "trace_persist_failed",
            evaluation_id=evaluation_id,
            exc_info=True,
        )


def _safe_forward_webhook(
    evaluation_id: str,
    bridge_secret: str,
    forward_url: str,
) -> None:
    """Forward completion to the bridge; logs failures without raising."""
    bridge_base = os.environ.get("WORKER_BRIDGE_URL", "http://127.0.0.1:8001").rstrip(
        "/"
    )
    url = f"{bridge_base}/webhook"
    payload = {
        "forward_url": forward_url,
        "evaluation_id": evaluation_id,
    }
    headers = {"X-Bridge-Secret": bridge_secret, "Content-Type": "application/json"}
    try:
        with httpx.Client(timeout=10.0) as client:
            response = client.post(url, json=payload, headers=headers)
            response.raise_for_status()
    except Exception:
        logger.error(
            "webhook_forward_failed",
            evaluation_id=evaluation_id,
            exc_info=True,
        )


@app.task(
    bind=True,
    name="agent_eval_lab.worker.tasks.run_evaluation_task",
    max_retries=_MAX_TASK_RETRIES,
    default_retry_delay=30,
    acks_late=True,
    reject_on_worker_lost=True,
)
def run_evaluation_task(
    self: Task,
    evaluation_id: str,
    config: dict[str, Any],
    scenario_ids: list[str],
    scenarios_dir: str,
    webhook_url: str,
) -> None:
    """
    Execute an evaluation, persist results to Postgres, and notify the app webhook.

    Args:
        self: Bound Celery task instance.
        evaluation_id: Primary key of the Evaluation row (also Celery task id).
        config: Evaluation configuration dict.
        scenario_ids: Scenarios to run.
        scenarios_dir: Path to scenario definitions.
        webhook_url: Next.js internal webhook URL (forwarded via worker bridge).
    """
    bridge_secret = os.environ.get("BRIDGE_SECRET", "")
    attempt = int(self.request.retries or 0) + 1

    try:
        st = _evaluation_status(evaluation_id)
        if st == "cancelled":
            logger.info(
                "evaluation_skipped_cancelled",
                evaluation_id=evaluation_id,
            )
            return

        _write_running(evaluation_id, attempt)

        st2 = _evaluation_status(evaluation_id)
        if st2 == "cancelled":
            logger.info(
                "evaluation_skipped_cancelled_after_running_mark",
                evaluation_id=evaluation_id,
            )
            return

        result = run_evaluation_from_config_dict(
            config, scenario_ids, scenarios_dir
        )
        summary = result.get("summary", {})
        safety_score = float(summary.get("safety_score", 0.0))
        reports = result.get("reports", {})
        report_html = str(reports.get("html", ""))
        report_md = str(reports.get("md", ""))
        raw_json = reports.get("json", "{}")
        report_json_obj = _parse_report_json(raw_json)

        _write_completed(
            evaluation_id,
            safety_score,
            report_html,
            report_json_obj,
            report_md,
        )

        report_json_for_storage = (
            raw_json
            if isinstance(raw_json, str)
            else json.dumps(report_json_obj)
        )
        artifact_refs = _store_artifacts(
            evaluation_id,
            report_html,
            report_md,
            report_json_for_storage,
        )
        logger.info(
            "artifacts_stored",
            evaluation_id=evaluation_id,
            count=len(artifact_refs),
        )

        # TODO(Phase 1B — REQUIRED FOR EXIT GATE):
        # Wire calibration_tracker.record() here once human-labeled
        # traces are available. Steps:
        # 1. Collect 150+ labeled traces per grader type
        # 2. For each label, call:
        #    from agent_eval_lab.evaluator.graders import calibration_tracker
        #    calibration_tracker.record(
        #        span_id=span.span_id,
        #        grader_type=grader_type,
        #        human_verdict=human_label,
        #        grader_verdict=grader_result.passed,
        #        grader_confidence=grader_result.confidence,
        #        llm_used="llm_path" in grader_result.metadata,
        #    )
        # 3. Check calibration_tracker.is_calibrated(grader_type)
        # 4. Phase 1B is NOT done until all three graders pass
        #    the 85% agreement gate on 150+ labeled traces.
        # This is the Phase 1B exit condition. Do not skip it.

        _write_trace_to_db(evaluation_id, result, config, scenario_ids)

        try:
            from agent_eval_lab.exporters.otel import (
                OtelExporter,
                fetch_eval_spans_for_evaluation,
            )

            exporter = OtelExporter()
            if exporter.config.enabled:
                spans_export = fetch_eval_spans_for_evaluation(evaluation_id)
                if spans_export:
                    exporter.export(spans_export)
        except Exception:
            logger.error(
                "otel_export_after_eval_failed",
                evaluation_id=evaluation_id,
                exc_info=True,
            )
        # TODO(Phase 2): pass spans directly from _write_trace_to_db to avoid DB
        # round-trip for export.

        logger.info(
            "evaluation_completed",
            evaluation_id=evaluation_id,
            safety_score=safety_score,
            status="completed",
        )

        if bridge_secret and webhook_url:
            _safe_forward_webhook(evaluation_id, bridge_secret, webhook_url)

    except ProviderError as exc:
        logger.warning(
            "evaluation_provider_error",
            evaluation_id=evaluation_id,
            error=str(exc),
            attempt=attempt,
        )
        if self.request.retries < _MAX_TASK_RETRIES:
            countdown = int(30 * (2 ** self.request.retries))
            raise self.retry(exc=exc, countdown=countdown) from exc
        _write_failed(evaluation_id, str(exc))
        logger.info(
            "evaluation_failed_after_retries",
            evaluation_id=evaluation_id,
            status="failed",
        )
        if bridge_secret and webhook_url:
            _safe_forward_webhook(evaluation_id, bridge_secret, webhook_url)

    except TimeoutError as exc:
        logger.warning(
            "evaluation_timeout",
            evaluation_id=evaluation_id,
            attempt=attempt,
            exc_info=True,
        )
        if self.request.retries < _MAX_TASK_RETRIES:
            countdown = int(30 * (2 ** self.request.retries))
            raise self.retry(exc=exc, countdown=countdown) from exc
        _write_failed(evaluation_id, str(exc))
        if bridge_secret and webhook_url:
            _safe_forward_webhook(evaluation_id, bridge_secret, webhook_url)

    except ConfigError as exc:
        logger.error(
            "evaluation_config_error",
            evaluation_id=evaluation_id,
            error=str(exc),
            exc_info=True,
        )
        _write_failed(evaluation_id, str(exc))
        if bridge_secret and webhook_url:
            _safe_forward_webhook(evaluation_id, bridge_secret, webhook_url)

    except Exception as exc:
        logger.error(
            "evaluation_unexpected_error",
            evaluation_id=evaluation_id,
            exc_info=True,
        )
        _write_failed(evaluation_id, str(exc))
        if bridge_secret and webhook_url:
            _safe_forward_webhook(evaluation_id, bridge_secret, webhook_url)


@app.task(
    bind=True,
    name="agent_eval_lab.worker.tasks.import_langsmith_task",
    max_retries=1,
    acks_late=True,
)
def import_langsmith_task(
    self: Task,
    evaluation_id: str,
    langsmith_api_key: str,
    project_name: str,
    limit: int = 50,
) -> None:
    """
    Import LangSmith traces into the eval platform.

    Fetches runs, maps to EvalSpan, runs graders, persists. Updates Evaluation
    status to completed or failed.
    """
    from agent_eval_lab.importers.langsmith import LangSmithConfig, LangSmithImporter

    attempt = int(self.request.retries or 0) + 1
    try:
        _write_running(evaluation_id, attempt)
        config = LangSmithConfig(
            api_key=langsmith_api_key,
            project_name=project_name,
            limit=limit,
        )
        with LangSmithImporter(config) as importer:
            result = importer.import_to_db(evaluation_id)

        report_md = (
            f"# LangSmith Import\n\n"
            f"- Traces: {result.traces_fetched}\n"
            f"- Spans: {result.spans_created}\n"
            f"- Eval runs: {result.eval_runs_created}\n"
        )
        if result.errors:
            report_md += "\n## Warnings\n" + "\n".join(
                f"- {e}" for e in result.errors
            )

        _write_completed(
            evaluation_id,
            safety_score=0.0,
            report_html=(
                f"<p>Imported {result.spans_created} spans "
                f"from {result.traces_fetched} traces.</p>"
            ),
            report_json=result.model_dump(mode="json"),
            report_markdown=report_md,
        )
        logger.info(
            "langsmith_import_completed",
            evaluation_id=evaluation_id,
            traces_fetched=result.traces_fetched,
            spans_created=result.spans_created,
            eval_runs_created=result.eval_runs_created,
        )
    except Exception as exc:
        logger.error(
            "langsmith_import_failed",
            evaluation_id=evaluation_id,
            exc_info=True,
        )
        _write_failed(evaluation_id, str(exc))
