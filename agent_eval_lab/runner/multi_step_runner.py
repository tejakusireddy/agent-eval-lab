"""
Multi-step scenario runner: drives the agent through tool sandbox sessions.

Wires HTTP tool environment (``tool_env``) to :class:`AgentAdapter` for scenarios
that require tool use across multiple turns.
"""

from __future__ import annotations

import asyncio
import json
import re
import secrets
import time
import uuid
from datetime import UTC, datetime
from typing import Any

import httpx
import structlog
from pydantic import BaseModel, Field

from agent_eval_lab.adapters.base import AgentAdapter
from agent_eval_lab.errors import ProviderError
from agent_eval_lab.evaluator.graders import default_registry
from agent_eval_lab.evaluator.scoring import ScenarioEvaluator, ScenarioStatus
from agent_eval_lab.runner.defenses import DefenseInterceptor
from agent_eval_lab.runner.enhanced_runner import _scenario_result_with_grader_snapshots
from agent_eval_lab.scenarios.base import Scenario, ScenarioResult
from agent_eval_lab.scenarios.loader import ScenarioDefinition
from agent_eval_lab.tool_env.tools.base import ToolMode
from agent_eval_lab.trace.models import EvalSpanModel, GraderResult, SpanEvent

logger = structlog.get_logger(__name__)

_JSON_BLOCK_RE = re.compile(
    r"```(?:json)?\s*(\{[\s\S]*?\})\s*```",
    re.IGNORECASE,
)
_INLINE_TOOL_RE = re.compile(
    r"\{\s*\"tool\"\s*:\s*\"([^\"]+)\"\s*,\s*\"args\"\s*:\s*(\{[\s\S]*?\})\s*\}",
)
_FUNC_CALL_RE = re.compile(
    r"^([a-zA-Z_][\w]*)\s*\(([^)]*)\)\s*$",
    re.MULTILINE,
)


class StepResult(BaseModel):
    """Result of one step in a multi-step scenario."""

    step: int
    prompt: str
    response: str
    tool_calls: list[dict[str, Any]] = Field(default_factory=list)
    tool_results: list[dict[str, Any]] = Field(default_factory=list)
    policy_decisions: list[dict[str, Any]] = Field(default_factory=list)
    span_id: str
    duration_ms: int


def _span_event_for_outcome(status: ScenarioStatus) -> SpanEvent:
    if status == ScenarioStatus.FAIL_CRITICAL:
        return SpanEvent.RUN_FAILED
    return SpanEvent.RUN_COMPLETED


class MultiStepRunner:
    """
    Run scenarios that require tool use across multiple steps.

    Creates a tool-env session, loops prompt → response → tool execution,
    collects :class:`EvalSpanModel` per step, and grades the final span.
    """

    def __init__(
        self,
        agent: AgentAdapter,
        tool_env_url: str,
        session_token: str | None = None,
        max_steps: int = 10,
        max_concurrency: int = 3,
        logger: Any | None = None,
        defense_interceptor: DefenseInterceptor | None = None,
    ) -> None:
        self.agent = agent
        self.tool_env_url = tool_env_url.rstrip("/")
        self._session_token = session_token
        self.max_steps = max(1, max_steps)
        self.max_concurrency = max(1, max_concurrency)
        self._defense_interceptor = defense_interceptor
        _ = logger

    async def run_scenarios(
        self,
        scenarios: list[Scenario],
        trace_id: str | None = None,
    ) -> tuple[list[ScenarioResult], list[EvalSpanModel]]:
        """
        Run multi-step scenarios; returns results and native ``EvalSpanModel`` rows.
        """
        tid = trace_id or secrets.token_hex(16)
        semaphore = asyncio.Semaphore(self.max_concurrency)

        async def run_limited(
            scenario: Scenario,
        ) -> tuple[ScenarioResult, list[EvalSpanModel]]:
            async with semaphore:
                return await self._run_single_scenario(scenario, tid)

        tasks = [run_limited(s) for s in scenarios]
        pairs = await asyncio.gather(*tasks)
        results = [p[0] for p in pairs]
        spans: list[EvalSpanModel] = []
        for _r, batch in pairs:
            spans.extend(batch)
        return results, spans

    def _tool_mode_for_scenario(self, scenario: Scenario) -> ToolMode:
        tags = {t.lower() for t in scenario.tags}
        if "adversarial_tools" in tags:
            return ToolMode.MALICIOUS
        return ToolMode.BENIGN

    async def _create_session(self, mode: ToolMode) -> tuple[str | None, str | None]:
        url = f"{self.tool_env_url}/sessions"
        headers = {"Content-Type": "application/json"}
        if self._session_token:
            headers["X-Session-Token"] = self._session_token
        body = {"seed": 42, "mode": mode.value, "fixture": "default"}
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                r = await client.post(url, json=body, headers=headers)
                r.raise_for_status()
                data = r.json()
                sid = data.get("session_id")
                if isinstance(sid, str):
                    return sid, None
                return None, "session_id missing in response"
        except Exception as exc:
            logger.warning("tool_env_session_create_failed", error=str(exc))
            return None, str(exc)

    async def _delete_session(self, session_id: str) -> None:
        url = f"{self.tool_env_url}/sessions/{session_id}"
        headers: dict[str, str] = {}
        if self._session_token:
            headers["X-Session-Token"] = self._session_token
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                r = await client.delete(url, headers=headers)
                r.raise_for_status()
        except Exception as exc:
            logger.warning(
                "tool_env_session_delete_failed",
                session_id=session_id,
                error=str(exc),
            )

    async def _call_tool(
        self,
        tool_env_url: str,
        session_id: str,
        run_id: str,
        tool_name: str,
        args: dict[str, Any],
    ) -> dict[str, Any]:
        """
        POST ``/tools/call``; never raises — returns an error-shaped dict on failure.
        """
        url = f"{tool_env_url.rstrip('/')}/tools/call"
        headers = {"Content-Type": "application/json"}
        if self._session_token:
            headers["X-Session-Token"] = self._session_token
        payload = {
            "tool": tool_name,
            "args": args,
            "session_id": session_id,
            "run_id": run_id,
        }
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                r = await client.post(url, json=payload, headers=headers)
                r.raise_for_status()
                out = r.json()
                if isinstance(out, dict):
                    return out
                return {"error": "invalid_response", "raw": out}
        except Exception as exc:
            return {
                "spec_version": "1.0",
                "session_id": session_id,
                "tool": tool_name,
                "result": {
                    "success": False,
                    "error": str(exc),
                    "data": None,
                },
                "span_id": "",
                "trace_emitted": False,
            }

    def _parse_tool_calls(self, response: str) -> list[dict[str, Any]]:
        """Parse tool calls from model text; never raises."""
        found: list[dict[str, Any]] = []
        try:
            for m in _JSON_BLOCK_RE.finditer(response):
                try:
                    obj = json.loads(m.group(1))
                    parsed = self._coerce_tool_obj(obj)
                    if parsed:
                        found.append(parsed)
                except (json.JSONDecodeError, TypeError, ValueError):
                    continue
            for m in _INLINE_TOOL_RE.finditer(response):
                try:
                    name, args_raw = m.group(1), m.group(2)
                    args_obj = json.loads(args_raw)
                    if isinstance(args_obj, dict):
                        found.append({"tool": name, "args": args_obj})
                except (json.JSONDecodeError, IndexError, TypeError, ValueError):
                    continue
            if not found:
                for line in response.splitlines():
                    line = line.strip()
                    if not line or line.startswith("#"):
                        continue
                    fm = _FUNC_CALL_RE.match(line)
                    if fm:
                        tool_name, args_blob = fm.group(1), fm.group(2)
                        args_d = self._parse_simple_kwargs(args_blob)
                        if args_d is not None:
                            found.append({"tool": tool_name, "args": args_d})
        except Exception:
            return []
        return found

    def _coerce_tool_obj(self, obj: Any) -> dict[str, Any] | None:
        if isinstance(obj, dict) and "tool" in obj:
            t = obj.get("tool")
            args = obj.get("args", {})
            if isinstance(t, str) and isinstance(args, dict):
                return {"tool": t, "args": args}
        if isinstance(obj, list):
            for item in obj:
                c = self._coerce_tool_obj(item)
                if c:
                    return c
        return None

    def _parse_simple_kwargs(self, blob: str) -> dict[str, Any] | None:
        if not blob.strip():
            return {}
        out: dict[str, Any] = {}
        for part in blob.split(","):
            part = part.strip()
            if "=" not in part:
                continue
            k, v = part.split("=", 1)
            k, v = k.strip(), v.strip().strip("\"'")
            out[k] = v
        return out

    def _format_tool_results(self, tool_results: list[dict[str, Any]]) -> str:
        lines: list[str] = []
        for tr in tool_results:
            tool_name = tr.get("tool", "unknown")
            if tr.get("blocked") is True:
                reason = tr.get("reason", "blocked")
                lines.append(f"[{tool_name}] Blocked: {reason}")
                continue
            res = tr.get("result", {})
            if isinstance(res, dict):
                if res.get("success"):
                    data = res.get("data", {})
                    lines.append(f"[{tool_name}] Success: {data}")
                else:
                    err = res.get("error", "unknown error")
                    lines.append(f"[{tool_name}] Failed: {err}")
            else:
                lines.append(f"[{tool_name}] {tr}")
        return "\n".join(lines) if lines else "(no tool results)"

    def _completion_hint(self, response: str) -> bool:
        upper = response.upper()
        return any(
            phrase in upper
            for phrase in ("DONE", "COMPLETED", "TASK COMPLETE", "TASK_COMPLETE")
        )

    async def _run_single_scenario(
        self, scenario: Scenario, trace_id: str
    ) -> tuple[ScenarioResult, list[EvalSpanModel]]:
        """Execute one scenario with multi-step tool loop and attempt retries."""
        scenario_def: ScenarioDefinition = scenario.get_definition()
        max_attempts = scenario_def.max_attempts
        mode = self._tool_mode_for_scenario(scenario)

        best_result: ScenarioResult | None = None
        best_spans: list[EvalSpanModel] | None = None
        best_score = -1.0
        scenario_start = time.perf_counter()

        for attempt in range(1, max_attempts + 1):
            run_id = str(uuid.uuid4())
            session_id, sess_err = await self._create_session(mode)
            if not session_id:
                logger.warning(
                    "multi_step_session_failed",
                    scenario_id=scenario.id,
                    error=sess_err,
                )
                return (
                    ScenarioResult(
                        scenario_id=scenario.id,
                        status=ScenarioStatus.FAIL_CRITICAL,
                        score=0.0,
                        tags=scenario.tags,
                        raw_prompt=scenario.build_prompt(),
                        raw_response="",
                        reasoning=f"Tool environment session failed: {sess_err}",
                        metadata={
                            "is_multi_step": True,
                            "attempt": attempt,
                            "error": sess_err,
                        },
                        fail_reasons=[str(sess_err or "session")],
                    ),
                    [],
                )

            step_results: list[StepResult] = []
            eval_spans: list[EvalSpanModel] = []
            parent_span_id: str | None = None
            current_prompt = scenario.build_prompt()
            last_prompt_for_model = current_prompt
            final_response = ""
            tool_calls_total = 0
            all_defense_violations: list[str] = []

            try:
                step_idx = 0
                while step_idx < self.max_steps:
                    step_idx += 1
                    step_started = datetime.now(UTC)
                    prompt_for_model = current_prompt
                    if self._defense_interceptor:
                        filtered, was_modified = (
                            self._defense_interceptor.filter_prompt(current_prompt)
                        )
                        if was_modified:
                            logger.info(
                                "prompt_filtered",
                                scenario_id=scenario.id,
                                original_len=len(current_prompt),
                                filtered_len=len(filtered),
                            )
                        prompt_for_model = filtered
                    try:
                        response = await self.agent.generate(prompt_for_model)
                    except ProviderError as exc:
                        step_completed = datetime.now(UTC)
                        duration_ms = max(
                            0,
                            int((step_completed - step_started).total_seconds() * 1000),
                        )
                        err_sid = secrets.token_hex(8)
                        step_results.append(
                            StepResult(
                                step=step_idx,
                                prompt=prompt_for_model,
                                response="",
                                span_id=err_sid,
                                duration_ms=duration_ms,
                            )
                        )
                        raise exc

                    step_completed = datetime.now(UTC)
                    duration_ms = max(
                        0,
                        int((step_completed - step_started).total_seconds() * 1000),
                    )
                    final_response = response
                    if self._defense_interceptor:
                        _, step_violations = self._defense_interceptor.scan_output(
                            response, prompt_for_model
                        )
                        if step_violations:
                            all_defense_violations.extend(step_violations)
                            logger.info(
                                "output_violations_detected",
                                scenario_id=scenario.id,
                                violations=step_violations,
                            )

                    tool_calls = self._parse_tool_calls(response)
                    tool_result_payloads: list[dict[str, Any]] = []
                    policy_accum: list[dict[str, Any]] = []

                    model_span_id = secrets.token_hex(8)
                    eval_spans.append(
                        EvalSpanModel(
                            span_id=model_span_id,
                            parent_span_id=parent_span_id,
                            trace_id=trace_id,
                            event_type=SpanEvent.MODEL_CALL,
                            scenario_id=scenario.id,
                            attempt=attempt,
                            started_at=step_started,
                            completed_at=step_completed,
                            duration_ms=duration_ms,
                            status=None,
                            score=None,
                            reasoning="",
                            raw_prompt=prompt_for_model,
                            raw_response=response,
                            tags=list(scenario.tags),
                            fail_reasons=[],
                            attributes={"step": step_idx},
                            trace_origin="native",
                        )
                    )
                    chain_tail = model_span_id

                    if tool_calls:
                        tool_calls_total += len(tool_calls)
                        for tc in tool_calls:
                            tname = str(tc.get("tool", ""))
                            raw_args = tc.get("args")
                            targs = raw_args if isinstance(raw_args, dict) else {}
                            allowed = True
                            block_reason = ""
                            if self._defense_interceptor:
                                allowed, block_reason = (
                                    self._defense_interceptor.validate_tool_call(
                                        tname, targs
                                    )
                                )
                            tool_span_id = secrets.token_hex(8)
                            t_start = datetime.now(UTC)
                            if not allowed:
                                tool_result_payloads.append(
                                    {
                                        "tool": tname,
                                        "blocked": True,
                                        "reason": block_reason,
                                    }
                                )
                                t_done = datetime.now(UTC)
                                t_dur = max(
                                    0,
                                    int((t_done - t_start).total_seconds() * 1000),
                                )
                                eval_spans.append(
                                    EvalSpanModel(
                                        span_id=tool_span_id,
                                        parent_span_id=model_span_id,
                                        trace_id=trace_id,
                                        event_type=SpanEvent.TOOL_CALL,
                                        scenario_id=scenario.id,
                                        attempt=attempt,
                                        started_at=t_start,
                                        completed_at=t_done,
                                        duration_ms=t_dur,
                                        status=None,
                                        score=None,
                                        reasoning="",
                                        raw_prompt="",
                                        raw_response="",
                                        tags=list(scenario.tags),
                                        fail_reasons=[],
                                        attributes={
                                            "tool": tname,
                                            "blocked": True,
                                            "reason": block_reason,
                                        },
                                        trace_origin="native",
                                    )
                                )
                                chain_tail = tool_span_id
                                continue
                            tr = await self._call_tool(
                                self.tool_env_url,
                                session_id,
                                run_id,
                                tname,
                                targs,
                            )
                            tool_result_payloads.append(
                                {"tool": tname, "result": tr.get("result", tr)}
                            )
                            if isinstance(tr, dict) and "policy" in tr:
                                policy_accum.append(tr["policy"])  # type: ignore[arg-type]
                            t_done = datetime.now(UTC)
                            t_dur = max(
                                0,
                                int((t_done - t_start).total_seconds() * 1000),
                            )
                            eval_spans.append(
                                EvalSpanModel(
                                    span_id=tool_span_id,
                                    parent_span_id=model_span_id,
                                    trace_id=trace_id,
                                    event_type=SpanEvent.TOOL_CALL,
                                    scenario_id=scenario.id,
                                    attempt=attempt,
                                    started_at=t_start,
                                    completed_at=t_done,
                                    duration_ms=t_dur,
                                    status=None,
                                    score=None,
                                    reasoning="",
                                    raw_prompt="",
                                    raw_response="",
                                    tags=list(scenario.tags),
                                    fail_reasons=[],
                                    attributes={
                                        "tool": tname,
                                        "result": tr.get("result", tr),
                                    },
                                    trace_origin="native",
                                )
                            )
                            chain_tail = tool_span_id

                    step_results.append(
                        StepResult(
                            step=step_idx,
                            prompt=prompt_for_model,
                            response=response,
                            tool_calls=tool_calls,
                            tool_results=tool_result_payloads,
                            policy_decisions=policy_accum,
                            span_id=model_span_id,
                            duration_ms=duration_ms,
                        )
                    )
                    parent_span_id = chain_tail
                    last_prompt_for_model = prompt_for_model

                    if self._completion_hint(response):
                        break
                    if not tool_calls:
                        break

                    tool_lines = self._format_tool_results(tool_result_payloads)
                    current_prompt = (
                        f"Previous response:\n{response}\n\n"
                        f"Tool results:\n{tool_lines}\n\n"
                        "Continue based on these results. Use tools if needed, "
                        "or respond with your final answer when done."
                    )

                evaluator = ScenarioEvaluator(scenario_def)
                evaluation = evaluator.evaluate(final_response, attempt)
                status = evaluation["status"]
                score = float(evaluation["score"])
                reasoning = str(evaluation["reasoning"])
                meta = dict(evaluation["metadata"])

                if score == 100.0:
                    status = ScenarioStatus.PASS

                final_evt = _span_event_for_outcome(status)
                final_span_id = secrets.token_hex(8)
                final_span = EvalSpanModel(
                    span_id=final_span_id,
                    parent_span_id=parent_span_id,
                    trace_id=trace_id,
                    event_type=final_evt,
                    scenario_id=scenario.id,
                    attempt=attempt,
                    started_at=datetime.now(UTC),
                    completed_at=datetime.now(UTC),
                    duration_ms=None,
                    status=status,
                    score=score if score in (0.0, 25.0, 50.0, 100.0) else None,
                    reasoning=reasoning,
                    raw_prompt=last_prompt_for_model,
                    raw_response=final_response,
                    tags=list(scenario.tags),
                    fail_reasons=list(meta.get("violations", [])),
                    attributes={
                        "steps": len(step_results),
                        "tool_calls_total": tool_calls_total,
                    },
                    trace_origin="native",
                )
                graded: list[GraderResult] = (
                    default_registry.grade_span_with_calibration_check(
                        final_span, require_calibration=False
                    )
                )
                final_span = final_span.model_copy(update={"grader_results": graded})
                eval_spans.append(final_span)

                exec_ms = int((time.perf_counter() - scenario_start) * 1000)
                meta["execution_time_ms"] = exec_ms
                meta["attempt_duration_ms"] = sum(s.duration_ms for s in step_results)
                meta["steps"] = [s.model_dump(mode="json") for s in step_results]
                meta["session_id"] = session_id
                meta["tool_calls_total"] = tool_calls_total
                meta["is_multi_step"] = True
                if all_defense_violations:
                    meta["defense_violations"] = all_defense_violations
                    meta["defense_active"] = True
                meta["trace_id"] = trace_id
                meta["eval_spans"] = [
                    s.model_dump(mode="json") for s in eval_spans
                ]

                result = ScenarioResult(
                    scenario_id=scenario.id,
                    status=status,
                    score=score,
                    tags=scenario.tags,
                    raw_prompt=scenario.build_prompt(),
                    raw_response=final_response,
                    reasoning=reasoning,
                    metadata=meta,
                    fail_reasons=meta.get("violations", []),
                )
                result = _scenario_result_with_grader_snapshots(result, final_span)

                if score > best_score:
                    best_score = score
                    best_result = result
                    best_spans = list(eval_spans)

                if status == ScenarioStatus.PASS:
                    return result, eval_spans

            except ProviderError as exc:
                logger.warning(
                    "multi_step_provider_error",
                    scenario_id=scenario.id,
                    attempt=attempt,
                    error=str(exc),
                )
                if attempt == max_attempts:
                    return (
                        ScenarioResult(
                            scenario_id=scenario.id,
                            status=ScenarioStatus.FAIL_CRITICAL,
                            score=0.0,
                            tags=scenario.tags,
                            raw_prompt=scenario.build_prompt(),
                            raw_response=final_response,
                            reasoning=f"Provider error: {exc}",
                            metadata={
                                "error_type": "ProviderError",
                                "attempt": attempt,
                                "is_multi_step": True,
                            },
                            fail_reasons=[str(exc)],
                        ),
                        [],
                    )
                await asyncio.sleep(2**attempt)
            except Exception as exc:
                logger.error(
                    "multi_step_unexpected_error",
                    scenario_id=scenario.id,
                    attempt=attempt,
                    exc_info=True,
                )
                if attempt == max_attempts:
                    return (
                        ScenarioResult(
                            scenario_id=scenario.id,
                            status=ScenarioStatus.FAIL_CRITICAL,
                            score=0.0,
                            tags=scenario.tags,
                            raw_prompt=scenario.build_prompt(),
                            raw_response="",
                            reasoning=f"Unexpected error: {exc}",
                            metadata={
                                "error_type": type(exc).__name__,
                                "attempt": attempt,
                                "is_multi_step": True,
                            },
                            fail_reasons=[str(exc)],
                        ),
                        [],
                    )
                await asyncio.sleep(2**attempt)
            finally:
                await self._delete_session(session_id)

        if best_result is not None and best_spans is not None:
            return best_result, best_spans

        return (
            ScenarioResult(
                scenario_id=scenario.id,
                status=ScenarioStatus.FAIL_CRITICAL,
                score=0.0,
                tags=scenario.tags,
                raw_prompt=scenario.build_prompt(),
                raw_response="",
                reasoning="All multi-step attempts failed",
                metadata={"is_multi_step": True, "attempts": max_attempts},
                fail_reasons=["All multi-step attempts failed"],
            ),
            [],
        )
