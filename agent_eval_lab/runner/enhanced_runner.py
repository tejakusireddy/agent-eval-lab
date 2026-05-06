"""Enhanced scenario runner with retries and YAML scenario support."""

import asyncio
import logging
import secrets
import time
from datetime import UTC, datetime

import structlog

from agent_eval_lab.adapters.base import AgentAdapter
from agent_eval_lab.errors import ProviderError
from agent_eval_lab.evaluator.graders import default_registry
from agent_eval_lab.evaluator.scoring import (
    ScenarioEvaluator,
    ScenarioStatus,
)
from agent_eval_lab.runner.defenses import DefenseInterceptor
from agent_eval_lab.scenarios.base import Scenario, ScenarioResult
from agent_eval_lab.scenarios.loader import ScenarioDefinition
from agent_eval_lab.trace.models import EvalSpanModel, SpanEvent

_CANONICAL_SCORES = frozenset({0.0, 25.0, 50.0, 100.0})


def _scenario_result_with_grader_snapshots(
    result: ScenarioResult, span: EvalSpanModel
) -> ScenarioResult:
    """Attach graded span outputs to the scenario result for JSON reporting."""
    return result.model_copy(
        update={
            "grader_results": [
                g.model_dump(mode="json") for g in span.grader_results
            ]
        }
    )


def _enhanced_span_event_for_status(status: ScenarioStatus) -> SpanEvent:
    """Map scenario outcome to span event (single-turn completion)."""
    if status == ScenarioStatus.FAIL_CRITICAL:
        return SpanEvent.RUN_FAILED
    return SpanEvent.RUN_COMPLETED


class EnhancedScenarioRunner:
    """
    Enhanced scenario runner with retry logic and YAML scenario support.

    Supports multiple attempts per scenario and comprehensive evaluation.
    """

    def __init__(
        self,
        agent: AgentAdapter,
        max_concurrency: int = 3,
        logger: logging.Logger | None = None,
        defense_interceptor: DefenseInterceptor | None = None,
    ) -> None:
        """
        Initialize the enhanced scenario runner.

        Args:
            agent: The agent adapter to test
            max_concurrency: Maximum concurrent scenario executions
            logger: Optional logger instance
            defense_interceptor: Optional runtime defense pipeline (prompt/output)
        """
        self.agent = agent
        self.max_concurrency = max_concurrency
        self._logger = logger or logging.getLogger(__name__)
        self._defense_interceptor = defense_interceptor
        self._slog = structlog.get_logger(__name__)

    def _native_span_for_result(
        self,
        trace_id: str,
        scenario: Scenario,
        result: ScenarioResult,
        *,
        attempt: int,
        started_at: datetime,
        completed_at: datetime,
    ) -> EvalSpanModel:
        """Build a graded native span for the final scenario outcome."""
        meta = dict(result.metadata) if result.metadata else {}
        duration_ms = max(
            0, int((completed_at - started_at).total_seconds() * 1000)
        )
        score_val = float(result.score)
        span_score = score_val if score_val in _CANONICAL_SCORES else None
        span = EvalSpanModel(
            span_id=secrets.token_hex(8),
            parent_span_id=None,
            trace_id=trace_id,
            event_type=_enhanced_span_event_for_status(result.status),
            scenario_id=scenario.id,
            attempt=attempt,
            started_at=started_at,
            completed_at=completed_at,
            duration_ms=duration_ms,
            status=result.status,
            score=span_score,
            reasoning=result.reasoning,
            raw_prompt=result.raw_prompt,
            raw_response=result.raw_response,
            tags=list(result.tags),
            fail_reasons=list(result.fail_reasons),
            attributes=meta,
            trace_origin="native",
        )
        graded = default_registry.grade_span_with_calibration_check(
            span, require_calibration=False
        )
        return span.model_copy(update={"grader_results": graded})

    async def run_scenarios(
        self,
        scenarios: list[Scenario],
        trace_id: str | None = None,
    ) -> tuple[list[ScenarioResult], list[EvalSpanModel]]:
        """
        Run a list of scenarios against the agent.

        Args:
            scenarios: List of scenarios to execute
            trace_id: Shared trace id for this batch (one per evaluation run)

        Returns:
            Scenario results and native EvalSpanModel rows (one span per scenario).
        """
        tid = trace_id or secrets.token_hex(16)
        semaphore = asyncio.Semaphore(self.max_concurrency)

        async def run_with_limit(
            scenario: Scenario,
        ) -> tuple[ScenarioResult, list[EvalSpanModel]]:
            async with semaphore:
                return await self._run_single_scenario(scenario, tid)

        tasks = [run_with_limit(scenario) for scenario in scenarios]
        pairs = await asyncio.gather(*tasks)
        results = [p[0] for p in pairs]
        spans: list[EvalSpanModel] = []
        for _r, batch in pairs:
            spans.extend(batch)
        return results, spans

    async def _run_single_scenario(
        self, scenario: Scenario, trace_id: str
    ) -> tuple[ScenarioResult, list[EvalSpanModel]]:
        """
        Run a single scenario with retry logic.

        Args:
            scenario: The scenario to execute

        Returns:
            Final ``ScenarioResult`` and one native graded span per scenario.
        """
        self._logger.info(
            f"Running scenario: {scenario.id} - {scenario.name}"
        )

        scenario_def: ScenarioDefinition = scenario.get_definition()
        max_attempts = scenario_def.max_attempts

        best_result: ScenarioResult | None = None
        best_spans: list[EvalSpanModel] | None = None
        best_score = -1.0
        scenario_start_time = time.time()

        for attempt in range(1, max_attempts + 1):
            attempt_start_dt = datetime.now(UTC)
            attempt_start_time = time.time()
            try:
                prompt = scenario.build_prompt()
                if self._defense_interceptor:
                    filtered_prompt, was_modified = (
                        self._defense_interceptor.filter_prompt(prompt)
                    )
                    if was_modified:
                        self._slog.info(
                            "prompt_filtered",
                            scenario_id=scenario.id,
                            original_len=len(prompt),
                            filtered_len=len(filtered_prompt),
                        )
                    prompt = filtered_prompt

                response = await self.agent.generate(prompt)
                attempt_duration_ms = int((time.time() - attempt_start_time) * 1000)

                defense_violations: list[str] = []
                if self._defense_interceptor:
                    _, defense_violations = self._defense_interceptor.scan_output(
                        response, prompt
                    )
                    if defense_violations:
                        self._slog.info(
                            "output_violations_detected",
                            scenario_id=scenario.id,
                            violations=defense_violations,
                        )

                evaluator = ScenarioEvaluator(scenario_def)
                evaluation = evaluator.evaluate(response, attempt)

                status = evaluation["status"]
                score = evaluation["score"]
                reasoning = evaluation["reasoning"]
                metadata = dict(evaluation["metadata"])
                if defense_violations:
                    metadata["defense_violations"] = defense_violations
                    metadata["defense_active"] = True

                # PASS detection: score == 100.0 → status = PASS
                # Ensure status is PASS if score is 100.0
                final_status = status
                if score == 100.0:
                    final_status = ScenarioStatus.PASS

                # Add execution time to metadata
                execution_time_ms = int((time.time() - scenario_start_time) * 1000)
                metadata["execution_time_ms"] = execution_time_ms
                metadata["attempt_duration_ms"] = attempt_duration_ms

                result = ScenarioResult(
                    scenario_id=scenario.id,
                    status=final_status,
                    score=score,
                    tags=scenario.tags,
                    raw_prompt=prompt,
                    raw_response=response,
                    reasoning=reasoning,
                    metadata=metadata,
                    fail_reasons=metadata.get("violations", []),
                )

                completed_at = datetime.now(UTC)
                native_span = self._native_span_for_result(
                    trace_id,
                    scenario,
                    result,
                    attempt=attempt,
                    started_at=attempt_start_dt,
                    completed_at=completed_at,
                )
                result = _scenario_result_with_grader_snapshots(result, native_span)
                batch = [native_span]

                if score > best_score:
                    best_score = score
                    best_result = result
                    best_spans = list(batch)

                if status == ScenarioStatus.PASS:
                    self._logger.info(
                        f"Scenario {scenario.id} passed on attempt {attempt}"
                    )
                    return result, batch

                self._logger.debug(
                    f"Scenario {scenario.id} attempt {attempt}: "
                    f"{status.value} (score: {score})"
                )

            except ProviderError as e:
                self._logger.warning(
                    f"Provider error in scenario {scenario.id} "
                    f"attempt {attempt}: {e}"
                )

                if attempt == max_attempts:
                    err_result = ScenarioResult(
                        scenario_id=scenario.id,
                        status=ScenarioStatus.FAIL_CRITICAL,
                        score=0.0,
                        tags=scenario.tags,
                        raw_prompt=scenario.build_prompt(),
                        raw_response="",
                        reasoning=f"Provider error: {str(e)}",
                        metadata={"error_type": "ProviderError", "attempt": attempt},
                        fail_reasons=[str(e)],
                    )
                    done_at = datetime.now(UTC)
                    err_span = self._native_span_for_result(
                        trace_id,
                        scenario,
                        err_result,
                        attempt=attempt,
                        started_at=attempt_start_dt,
                        completed_at=done_at,
                    )
                    err_result = _scenario_result_with_grader_snapshots(
                        err_result, err_span
                    )
                    return err_result, [err_span]

                await asyncio.sleep(2**attempt)

            except Exception as e:
                self._logger.error(
                    f"Unexpected error in scenario {scenario.id} "
                    f"attempt {attempt}: {e}",
                    exc_info=True,
                )

                if attempt == max_attempts:
                    err_result = ScenarioResult(
                        scenario_id=scenario.id,
                        status=ScenarioStatus.FAIL_CRITICAL,
                        score=0.0,
                        tags=scenario.tags,
                        raw_prompt=scenario.build_prompt(),
                        raw_response="",
                        reasoning=f"Unexpected error: {str(e)}",
                        metadata={
                            "error_type": type(e).__name__,
                            "attempt": attempt,
                        },
                        fail_reasons=[f"Unexpected error: {str(e)}"],
                    )
                    done_at = datetime.now(UTC)
                    err_span = self._native_span_for_result(
                        trace_id,
                        scenario,
                        err_result,
                        attempt=attempt,
                        started_at=attempt_start_dt,
                        completed_at=done_at,
                    )
                    err_result = _scenario_result_with_grader_snapshots(
                        err_result, err_span
                    )
                    return err_result, [err_span]

                await asyncio.sleep(2**attempt)

        if best_result and best_spans is not None:
            self._logger.info(
                f"Scenario {scenario.id} completed: "
                f"{best_result.status.value} (score: {best_result.score})"
            )
            return best_result, best_spans

        fallback = ScenarioResult(
            scenario_id=scenario.id,
            status=ScenarioStatus.FAIL_CRITICAL,
            score=0.0,
            tags=scenario.tags,
            raw_prompt=scenario.build_prompt(),
            raw_response="",
            reasoning="All attempts failed",
            metadata={"attempts": max_attempts},
            fail_reasons=["All attempts failed"],
        )
        fb_at = datetime.now(UTC)
        fb_span = self._native_span_for_result(
            trace_id,
            scenario,
            fallback,
            attempt=max_attempts,
            started_at=datetime.now(UTC),
            completed_at=fb_at,
        )
        fallback = _scenario_result_with_grader_snapshots(fallback, fb_span)
        return fallback, [fb_span]
