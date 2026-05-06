"""Main EvalTracer implementation (best-effort, non-blocking semantics)."""

from __future__ import annotations

import asyncio
import sys
import traceback
from contextvars import ContextVar
from threading import local
from typing import Any, Literal, Optional, Type, cast
from uuid import uuid4

from agent_eval_sdk._transport import send_event
from agent_eval_sdk.models import (
    TracerConfig,
    build_human_approval_event,
    build_model_call_event,
    build_policy_decision_event,
    build_run_completed_event,
    build_run_failed_event,
    build_run_started_event,
    build_tool_call_event,
    build_tool_result_event,
)

_PREVIEW_MAX = 500

_run_id_async: ContextVar[Optional[str]] = ContextVar(
    "agent_eval_sdk_run_id", default=None
)


def _truncate_preview(text: str | None) -> str | None:
    if text is None:
        return None
    if len(text) <= _PREVIEW_MAX:
        return text
    return text[:_PREVIEW_MAX]


class EvalTracer:
    """Emit thin trace events to AgentEvalLab (fire-and-forget).

    All methods are safe to call from user code: they never raise (errors are
    logged to stderr). If the tracer is disabled or the API key is missing,
    operations are no-ops except :meth:`run_started`, which still returns a new
    ``run_id`` for local correlation.
    """

    def __init__(self, config: TracerConfig) -> None:
        self._config = config
        self._local = local()

    @classmethod
    def from_env(cls) -> EvalTracer:
        """Construct a tracer using :meth:`TracerConfig.from_env`."""
        return cls(TracerConfig.from_env())

    # PEP 8 name; TypeScript-style alias for parity with other SDKs
    fromEnv = from_env

    def _sync_run_id(self) -> str | None:
        return getattr(self._local, "run_id", None)

    def _set_sync_run_id(self, value: str | None) -> None:
        self._local.run_id = value

    def _emit(self, event_dict: dict[str, Any]) -> None:
        try:
            send_event(event_dict, self._config)
        except Exception as e:
            print(f"[agent-eval-sdk] emit failed: {e}", file=sys.stderr)
            traceback.print_exc(file=sys.stderr)

    def run_started(
        self,
        agent_id: str | None = None,
        scenario_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> str:
        """Start a traced run; emit ``run_started`` and return a new ``run_id``."""
        run_id = str(uuid4())
        self._set_sync_run_id(run_id)
        ev = build_run_started_event(
            run_id=run_id,
            evaluation_id=self._config.evaluation_id,
            agent_id=agent_id,
            scenario_id=scenario_id,
            metadata=metadata,
        )
        self._emit(ev.to_wire_dict())
        return run_id

    def tool_call(
        self,
        tool_name: str,
        tool_input: dict[str, Any] | None = None,
    ) -> str:
        """Emit ``tool_call``; return ``span_id``."""
        run_id = self._sync_run_id()
        if not run_id:
            print(
                "[agent-eval-sdk] tool_call skipped: no active run_id (call run_started first)",
                file=sys.stderr,
            )
            return str(uuid4())
        span_id = str(uuid4())
        ev = build_tool_call_event(
            run_id=run_id,
            evaluation_id=self._config.evaluation_id,
            tool_name=tool_name,
            tool_input=tool_input,
            span_id=span_id,
        )
        self._emit(ev.to_wire_dict())
        return span_id

    def model_call(
        self,
        model: str,
        prompt_preview: str | None = None,
        response_preview: str | None = None,
        duration_ms: int | None = None,
        input_tokens: int | None = None,
        output_tokens: int | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        """Emit ``model_call`` event. No return value needed."""
        run_id = self._sync_run_id()
        if not run_id:
            print(
                "[agent-eval-sdk] model_call skipped: no active run_id (call run_started first)",
                file=sys.stderr,
            )
            return
        ev = build_model_call_event(
            run_id=run_id,
            evaluation_id=self._config.evaluation_id,
            model=model,
            prompt_preview=prompt_preview,
            response_preview=response_preview,
            duration_ms=duration_ms,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            metadata=metadata,
        )
        self._emit(ev.to_wire_dict())

    def tool_result(
        self,
        tool_name: str,
        span_id: str,
        success: bool,
        result_preview: str | None = None,
        error: str | None = None,
        duration_ms: int | None = None,
    ) -> None:
        """Emit ``tool_result`` event linking back to a tool_call span."""
        run_id = self._sync_run_id()
        if not run_id:
            print(
                "[agent-eval-sdk] tool_result skipped: no active run_id (call run_started first)",
                file=sys.stderr,
            )
            return
        ev = build_tool_result_event(
            run_id=run_id,
            evaluation_id=self._config.evaluation_id,
            tool_name=tool_name,
            span_id=span_id,
            success=success,
            result_preview=result_preview,
            error=error,
            duration_ms=duration_ms,
        )
        self._emit(ev.to_wire_dict())

    def policy_decision(
        self,
        decision: str,
        reason: str,
        policy_id: str | None = None,
        resource: str | None = None,
        span_id: str | None = None,
    ) -> None:
        """Emit ``policy_decision`` event."""
        run_id = self._sync_run_id()
        if not run_id:
            print(
                "[agent-eval-sdk] policy_decision skipped: no active run_id (call run_started first)",
                file=sys.stderr,
            )
            return
        if decision not in ("allow", "deny", "audit"):
            print(
                f"[agent-eval-sdk] policy_decision skipped: invalid decision {decision!r}",
                file=sys.stderr,
            )
            return
        d = cast(Literal["allow", "deny", "audit"], decision)
        ev = build_policy_decision_event(
            run_id=run_id,
            evaluation_id=self._config.evaluation_id,
            decision=d,
            reason=reason,
            policy_id=policy_id,
            resource=resource,
            span_id=span_id,
        )
        self._emit(ev.to_wire_dict())

    def human_approval(
        self,
        approved: bool,
        approver_id: str | None = None,
        reason: str | None = None,
        span_id: str | None = None,
        timeout_seconds: int | None = None,
    ) -> None:
        """Emit ``human_approval`` event."""
        run_id = self._sync_run_id()
        if not run_id:
            print(
                "[agent-eval-sdk] human_approval skipped: no active run_id (call run_started first)",
                file=sys.stderr,
            )
            return
        ev = build_human_approval_event(
            run_id=run_id,
            evaluation_id=self._config.evaluation_id,
            approved=approved,
            approver_id=approver_id,
            reason=reason,
            span_id=span_id,
            timeout_seconds=timeout_seconds,
        )
        self._emit(ev.to_wire_dict())

    def run_completed(
        self,
        duration_ms: int | None = None,
        output_preview: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        """Emit ``run_completed`` and clear the active ``run_id``."""
        run_id = self._sync_run_id()
        self._set_sync_run_id(None)
        if not run_id:
            return
        ev = build_run_completed_event(
            run_id=run_id,
            evaluation_id=self._config.evaluation_id,
            duration_ms=duration_ms,
            output_preview=_truncate_preview(output_preview),
            metadata=metadata,
        )
        self._emit(ev.to_wire_dict())

    def run_failed(
        self,
        error: str,
        error_type: str | None = None,
        duration_ms: int | None = None,
    ) -> None:
        """Emit ``run_failed`` and clear the active ``run_id``."""
        run_id = self._sync_run_id()
        self._set_sync_run_id(None)
        if not run_id:
            return
        ev = build_run_failed_event(
            run_id=run_id,
            evaluation_id=self._config.evaluation_id,
            error=error,
            error_type=error_type,
            duration_ms=duration_ms,
        )
        self._emit(ev.to_wire_dict())

    def __enter__(self) -> EvalTracer:
        self.run_started()
        return self

    def __exit__(
        self,
        exc_type: Optional[Type[BaseException]],
        exc_val: Optional[BaseException],
        exc_tb: Optional[Any],
    ) -> bool:
        if exc_type is not None:
            msg = str(exc_val) if exc_val is not None else ""
            self.run_failed(error=msg, error_type=getattr(exc_type, "__name__", None))
        else:
            self.run_completed()
        return False

    async def a_run_started(
        self,
        agent_id: str | None = None,
        scenario_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> str:
        """Start a traced run asynchronously (HTTP runs in a thread pool)."""
        run_id = str(uuid4())
        _run_id_async.set(run_id)
        ev = build_run_started_event(
            run_id=run_id,
            evaluation_id=self._config.evaluation_id,
            agent_id=agent_id,
            scenario_id=scenario_id,
            metadata=metadata,
        )
        await self._a_emit(ev.to_wire_dict())
        return run_id

    async def a_tool_call(
        self,
        tool_name: str,
        tool_input: dict[str, Any] | None = None,
    ) -> str:
        """Emit ``tool_call`` asynchronously."""
        run_id = _run_id_async.get()
        if not run_id:
            print(
                "[agent-eval-sdk] a_tool_call skipped: no active run_id",
                file=sys.stderr,
            )
            return str(uuid4())
        span_id = str(uuid4())
        ev = build_tool_call_event(
            run_id=run_id,
            evaluation_id=self._config.evaluation_id,
            tool_name=tool_name,
            tool_input=tool_input,
            span_id=span_id,
        )
        await self._a_emit(ev.to_wire_dict())
        return span_id

    async def a_model_call(
        self,
        model: str,
        prompt_preview: str | None = None,
        response_preview: str | None = None,
        duration_ms: int | None = None,
        input_tokens: int | None = None,
        output_tokens: int | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        """Emit ``model_call`` event asynchronously."""
        run_id = _run_id_async.get()
        if not run_id:
            print(
                "[agent-eval-sdk] a_model_call skipped: no active run_id",
                file=sys.stderr,
            )
            return
        ev = build_model_call_event(
            run_id=run_id,
            evaluation_id=self._config.evaluation_id,
            model=model,
            prompt_preview=prompt_preview,
            response_preview=response_preview,
            duration_ms=duration_ms,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            metadata=metadata,
        )
        await self._a_emit(ev.to_wire_dict())

    async def a_tool_result(
        self,
        tool_name: str,
        span_id: str,
        success: bool,
        result_preview: str | None = None,
        error: str | None = None,
        duration_ms: int | None = None,
    ) -> None:
        """Emit ``tool_result`` event asynchronously."""
        run_id = _run_id_async.get()
        if not run_id:
            print(
                "[agent-eval-sdk] a_tool_result skipped: no active run_id",
                file=sys.stderr,
            )
            return
        ev = build_tool_result_event(
            run_id=run_id,
            evaluation_id=self._config.evaluation_id,
            tool_name=tool_name,
            span_id=span_id,
            success=success,
            result_preview=result_preview,
            error=error,
            duration_ms=duration_ms,
        )
        await self._a_emit(ev.to_wire_dict())

    async def a_policy_decision(
        self,
        decision: str,
        reason: str,
        policy_id: str | None = None,
        resource: str | None = None,
        span_id: str | None = None,
    ) -> None:
        """Emit ``policy_decision`` event asynchronously."""
        run_id = _run_id_async.get()
        if not run_id:
            print(
                "[agent-eval-sdk] a_policy_decision skipped: no active run_id",
                file=sys.stderr,
            )
            return
        if decision not in ("allow", "deny", "audit"):
            print(
                f"[agent-eval-sdk] a_policy_decision skipped: invalid decision {decision!r}",
                file=sys.stderr,
            )
            return
        d = cast(Literal["allow", "deny", "audit"], decision)
        ev = build_policy_decision_event(
            run_id=run_id,
            evaluation_id=self._config.evaluation_id,
            decision=d,
            reason=reason,
            policy_id=policy_id,
            resource=resource,
            span_id=span_id,
        )
        await self._a_emit(ev.to_wire_dict())

    async def a_human_approval(
        self,
        approved: bool,
        approver_id: str | None = None,
        reason: str | None = None,
        span_id: str | None = None,
        timeout_seconds: int | None = None,
    ) -> None:
        """Emit ``human_approval`` event asynchronously."""
        run_id = _run_id_async.get()
        if not run_id:
            print(
                "[agent-eval-sdk] a_human_approval skipped: no active run_id",
                file=sys.stderr,
            )
            return
        ev = build_human_approval_event(
            run_id=run_id,
            evaluation_id=self._config.evaluation_id,
            approved=approved,
            approver_id=approver_id,
            reason=reason,
            span_id=span_id,
            timeout_seconds=timeout_seconds,
        )
        await self._a_emit(ev.to_wire_dict())

    async def a_run_completed(
        self,
        duration_ms: int | None = None,
        output_preview: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        """Emit ``run_completed`` asynchronously."""
        run_id = _run_id_async.get()
        _run_id_async.set(None)
        if not run_id:
            return
        ev = build_run_completed_event(
            run_id=run_id,
            evaluation_id=self._config.evaluation_id,
            duration_ms=duration_ms,
            output_preview=_truncate_preview(output_preview),
            metadata=metadata,
        )
        await self._a_emit(ev.to_wire_dict())

    async def a_run_failed(
        self,
        error: str,
        error_type: str | None = None,
        duration_ms: int | None = None,
    ) -> None:
        """Emit ``run_failed`` asynchronously."""
        run_id = _run_id_async.get()
        _run_id_async.set(None)
        if not run_id:
            return
        ev = build_run_failed_event(
            run_id=run_id,
            evaluation_id=self._config.evaluation_id,
            error=error,
            error_type=error_type,
            duration_ms=duration_ms,
        )
        await self._a_emit(ev.to_wire_dict())

    async def _a_emit(self, event_dict: dict[str, Any]) -> None:
        loop = asyncio.get_running_loop()

        def _safe_send() -> None:
            try:
                send_event(event_dict, self._config)
            except Exception as e:
                print(f"[agent-eval-sdk] emit failed: {e}", file=sys.stderr)
                traceback.print_exc(file=sys.stderr)

        try:
            await loop.run_in_executor(None, _safe_send)
        except Exception as e:
            print(f"[agent-eval-sdk] executor error: {e}", file=sys.stderr)
