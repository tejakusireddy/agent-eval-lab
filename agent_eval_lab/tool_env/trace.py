"""Fire-and-forget trace emission to the platform SDK ingest endpoint."""

from __future__ import annotations

import os
import threading
import uuid
from datetime import datetime, timezone
from typing import Any

import httpx
import structlog

from agent_eval_lab.tool_env.policy import PolicyDecision
from agent_eval_lab.tool_env.tools.base import ToolResult

logger = structlog.get_logger(__name__)


def _utc_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace(
        "+00:00", "Z"
    )


class ToolEnvTracer:
    """
    Emits typed trace events to ``POST /api/v1/sdk/events``.

    If ``AGENT_EVAL_API_KEY`` is unset, logs via structlog only (never raises).
    HTTP posts run in a daemon thread with a 2s timeout (non-blocking).
    """

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
    ) -> None:
        self._api_key = (api_key or os.environ.get("AGENT_EVAL_API_KEY") or "").strip()
        self._base_url = (
            base_url
            or os.environ.get("AGENT_EVAL_BASE_URL", "https://app.agenteval.dev")
        ).rstrip("/")
        self._evaluation_id = (
            os.environ.get("AGENT_EVAL_EVALUATION_ID") or ""
        ).strip() or None
        self.enabled = bool(self._api_key)

    def _effective_run_id(self, run_id: str | None, session_id: str) -> str:
        if run_id:
            return run_id
        return str(uuid.uuid5(uuid.NAMESPACE_URL, f"tool-env:{session_id}"))

    def _enqueue(self, event_type: str, run_id: str, payload: dict[str, Any]) -> None:
        body: dict[str, Any] = {
            "spec_version": "1.0",
            "event_type": event_type,
            "run_id": run_id,
            "timestamp": _utc_iso(),
            "payload": payload,
        }
        if self._evaluation_id:
            body["evaluation_id"] = self._evaluation_id

        if not self.enabled:
            logger.info("tool_env_trace", **body)
            return

        url = f"{self._base_url}/api/v1/sdk/events"
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

        def worker() -> None:
            try:
                with httpx.Client(timeout=2.0) as client:
                    client.post(url, json=body, headers=headers)
            except Exception:
                logger.warning(
                    "tool_env_trace_post_failed",
                    event_type=event_type,
                    run_id=run_id,
                    exc_info=True,
                )

        threading.Thread(target=worker, daemon=True).start()

    def emit_tool_call_started(
        self,
        run_id: str | None,
        session_id: str,
        tool: str,
        args: dict[str, Any],
        span_id: str,
    ) -> None:
        """Emit ``tool_call_started``."""
        rid = self._effective_run_id(run_id, session_id)
        self._enqueue(
            "tool_call_started",
            rid,
            {
                "session_id": session_id,
                "tool_name": tool,
                "tool_input": dict(args),
                "span_id": span_id,
            },
        )

    def emit_tool_call_completed(
        self,
        run_id: str | None,
        session_id: str,
        tool: str,
        result: ToolResult,
        span_id: str,
        duration_ms: int,
    ) -> None:
        """Emit ``tool_call_completed``."""
        rid = self._effective_run_id(run_id, session_id)
        self._enqueue(
            "tool_call_completed",
            rid,
            {
                "session_id": session_id,
                "tool_name": tool,
                "span_id": span_id,
                "duration_ms": duration_ms,
                "success": result.success,
                "policy_decision": result.policy_decision,
            },
        )

    def emit_tool_call_failed(
        self,
        run_id: str | None,
        session_id: str,
        tool: str,
        error: str,
        span_id: str,
        duration_ms: int,
    ) -> None:
        """Emit ``tool_call_failed``."""
        rid = self._effective_run_id(run_id, session_id)
        self._enqueue(
            "tool_call_failed",
            rid,
            {
                "session_id": session_id,
                "tool_name": tool,
                "span_id": span_id,
                "duration_ms": duration_ms,
                "error": error,
            },
        )

    def emit_policy_decision(
        self,
        run_id: str | None,
        session_id: str,
        tool: str,
        operation: str,
        decision: PolicyDecision,
        reason: str,
        span_id: str,
    ) -> None:
        """Emit ``policy_decision``."""
        rid = self._effective_run_id(run_id, session_id)
        self._enqueue(
            "policy_decision",
            rid,
            {
                "session_id": session_id,
                "tool_name": tool,
                "operation": operation,
                "decision": decision.value,
                "reason": reason,
                "span_id": span_id,
            },
        )

    def emit_state_mutation(
        self,
        run_id: str | None,
        session_id: str,
        tool: str,
        mutation_type: str,
        resource_path: str,
        span_id: str,
    ) -> None:
        """Emit ``state_mutation``."""
        rid = self._effective_run_id(run_id, session_id)
        self._enqueue(
            "state_mutation",
            rid,
            {
                "session_id": session_id,
                "tool_name": tool,
                "mutation_type": mutation_type,
                "resource_path": resource_path,
                "span_id": span_id,
            },
        )
