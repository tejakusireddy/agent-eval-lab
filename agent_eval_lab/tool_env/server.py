"""FastAPI adversarial tool environment (default port 8002)."""

from __future__ import annotations

import os
import time
import uuid
from typing import Annotated, Any

import structlog
import uvicorn
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from agent_eval_lab.tool_env.fixtures.loader import load_fixture
from agent_eval_lab.tool_env.policy import PermissionRule, PolicyChecker, PolicyDecision
from agent_eval_lab.tool_env.session import Session, SessionStore
from agent_eval_lab.tool_env.tools.base import BaseTool, ToolCallRequest, ToolCallResponse, ToolMode, ToolResult
from agent_eval_lab.tool_env.tools.calendar import CalendarTool
from agent_eval_lab.tool_env.tools.email import EmailTool
from agent_eval_lab.tool_env.tools.filesystem import FilesystemTool
from agent_eval_lab.tool_env.tools.search import SearchTool
from agent_eval_lab.tool_env.trace import ToolEnvTracer

logger = structlog.get_logger(__name__)

store = SessionStore()
tracer = ToolEnvTracer()
_fs_tool = FilesystemTool()
_email_tool = EmailTool()
_cal_tool = CalendarTool()
_search_tool = SearchTool()
_TOOL_REGISTRY: dict[str, BaseTool] = {
    _fs_tool.name: _fs_tool,
    _email_tool.name: _email_tool,
    _cal_tool.name: _cal_tool,
    _search_tool.name: _search_tool,
}


def _checker_for_session(session: Session) -> PolicyChecker:
    rules = [
        PermissionRule.model_validate(r) for r in session.policy_rules
    ]
    return PolicyChecker(rules)


def _verify_session_token(
    x_session_token: Annotated[str | None, Header(alias="X-Session-Token")] = None,
) -> None:
    expected = os.environ.get("SESSION_TOKEN")
    if not expected:
        return
    if x_session_token != expected:
        raise HTTPException(status_code=401, detail="Invalid or missing session token")


class CreateSessionBody(BaseModel):
    """Request body for ``POST /sessions``."""

    seed: int = 0
    mode: ToolMode = ToolMode.BENIGN
    fixture: str | None = Field(
        default=None,
        description="Fixture name (e.g. default) or path to .yaml",
    )


def create_app() -> FastAPI:
    """Build FastAPI application (for tests and uvicorn)."""
    app = FastAPI(
        title="AgentEvalLab Tool Environment",
        version="0.1.0",
        description="Stateful adversarial multi-tool sandbox for evaluations.",
    )

    @app.get("/health")
    async def health() -> dict[str, Any]:
        return {"status": "ok", "sessions": await store.count()}

    @app.post("/sessions", dependencies=[Depends(_verify_session_token)])
    async def create_session(body: CreateSessionBody) -> dict[str, Any]:
        fix: dict[str, Any] | None = None
        if body.fixture:
            try:
                fix = load_fixture(body.fixture)
            except FileNotFoundError as e:
                raise HTTPException(status_code=400, detail=str(e)) from e
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e)) from e
        session = await store.create(
            seed=body.seed,
            mode=body.mode,
            fixture=fix,
        )
        logger.info(
            "tool_env_session_created",
            session_id=session.session_id,
            seed=session.seed,
            mode=session.mode.value,
        )
        return {
            "session_id": session.session_id,
            "mode": session.mode.value,
            "seed": session.seed,
            "created_at": session.created_at.isoformat(),
        }

    @app.delete("/sessions/{session_id}", dependencies=[Depends(_verify_session_token)])
    async def delete_session(session_id: str) -> dict[str, str]:
        await store.delete(session_id)
        return {"status": "deleted", "session_id": session_id}

    @app.get(
        "/sessions/{session_id}/snapshot",
        dependencies=[Depends(_verify_session_token)],
    )
    async def get_snapshot(session_id: str) -> dict[str, Any]:
        snap = await store.snapshot(session_id)
        if not snap:
            raise HTTPException(status_code=404, detail="Session not found")
        return snap

    @app.post(
        "/sessions/{session_id}/reset",
        dependencies=[Depends(_verify_session_token)],
    )
    async def reset_session(session_id: str) -> dict[str, Any]:
        session = await store.reset(session_id)
        if session is None:
            raise HTTPException(status_code=404, detail="Session not found")
        return {
            "session_id": session.session_id,
            "mode": session.mode.value,
            "seed": session.seed,
            "created_at": session.created_at.isoformat(),
        }

    @app.get("/tools", dependencies=[Depends(_verify_session_token)])
    async def list_tools() -> dict[str, Any]:
        tools_out: list[dict[str, Any]] = []
        for t in _TOOL_REGISTRY.values():
            tools_out.append(
                {
                    "name": t.name,
                    "description": t.description,
                    "operations": t.operations,
                }
            )
        return {"tools": tools_out}

    @app.post("/tools/call", dependencies=[Depends(_verify_session_token)])
    async def call_tool(body: ToolCallRequest) -> ToolCallResponse:
        tool_name = body.tool
        if tool_name not in _TOOL_REGISTRY:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown tool: {tool_name!r}",
            )
        tool = _TOOL_REGISTRY[tool_name]
        ok, err = tool.validate_args(body.args)
        if not ok:
            raise HTTPException(status_code=400, detail=err)

        span_id = str(uuid.uuid4())
        t0 = time.perf_counter()
        op = str(body.args.get("operation", "*"))

        async with store.lock_session(body.session_id) as session:
            if session is None:
                raise HTTPException(status_code=404, detail="Session not found")

            session.tool_call_counter += 1

            tracer.emit_tool_call_started(
                body.run_id,
                session.session_id,
                tool_name,
                body.args,
                span_id,
            )

            checker = _checker_for_session(session)
            decision, reason = checker.check(tool_name, op, body.args, session)
            session.policy_decisions.append(
                {
                    "tool": tool_name,
                    "operation": op,
                    "decision": decision.value,
                    "reason": reason,
                    "span_id": span_id,
                }
            )
            tracer.emit_policy_decision(
                body.run_id,
                session.session_id,
                tool_name,
                op,
                decision,
                reason,
                span_id,
            )

            if decision == PolicyDecision.DENY:
                duration_ms = int((time.perf_counter() - t0) * 1000)
                result = ToolResult(
                    success=False,
                    error=f"policy_denied: {reason}",
                    mode=session.mode,
                    policy_checked=True,
                    policy_decision="deny",
                )
                tracer.emit_tool_call_completed(
                    body.run_id,
                    session.session_id,
                    tool_name,
                    result,
                    span_id,
                    duration_ms,
                )
                session.call_log.append(
                    {
                        "tool": tool_name,
                        "operation": op,
                        "args": dict(body.args),
                        "success": False,
                        "span_id": span_id,
                        "policy": "deny",
                    }
                )
                return ToolCallResponse(
                    session_id=body.session_id,
                    tool=tool_name,
                    result=result,
                    span_id=span_id,
                    trace_emitted=tracer.enabled,
                )

            policy_label = (
                "audit" if decision == PolicyDecision.AUDIT else "allow"
            )
            try:
                result = tool.execute(body.args, session, session.mode)
            except Exception as exc:
                logger.error(
                    "tool_execute_unexpected",
                    tool=tool_name,
                    session_id=body.session_id,
                    exc_info=True,
                )
                result = ToolResult(
                    success=False,
                    error=str(exc),
                    mode=session.mode,
                    policy_checked=True,
                    policy_decision=policy_label,
                )

            result = result.model_copy(
                update={
                    "policy_checked": True,
                    "policy_decision": policy_label,
                }
            )

            duration_ms = int((time.perf_counter() - t0) * 1000)

            if result.success:
                tracer.emit_tool_call_completed(
                    body.run_id,
                    session.session_id,
                    tool_name,
                    result,
                    span_id,
                    duration_ms,
                )
                _emit_state_mutations(
                    body.run_id,
                    session.session_id,
                    tool_name,
                    op,
                    body.args,
                    span_id,
                )
            else:
                tracer.emit_tool_call_failed(
                    body.run_id,
                    session.session_id,
                    tool_name,
                    result.error or "error",
                    span_id,
                    duration_ms,
                )

            session.call_log.append(
                {
                    "tool": tool_name,
                    "operation": op,
                    "args": dict(body.args),
                    "success": result.success,
                    "span_id": span_id,
                    "policy": policy_label,
                }
            )

            return ToolCallResponse(
                session_id=body.session_id,
                tool=tool_name,
                result=result,
                span_id=span_id,
                trace_emitted=tracer.enabled,
            )

    return app


def _emit_state_mutations(
    run_id: str | None,
    session_id: str,
    tool_name: str,
    operation: str,
    args: dict[str, Any],
    span_id: str,
) -> None:
    path_arg = args.get("path")
    path_str = path_arg if isinstance(path_arg, str) else ""

    if tool_name == "filesystem" and operation in ("write_file", "delete_file"):
        tracer.emit_state_mutation(
            run_id,
            session_id,
            tool_name,
            "update" if operation == "write_file" else "delete",
            f"/files{path_str}" if path_str.startswith("/") else f"/files/{path_str}",
            span_id,
        )
    elif tool_name == "email" and operation == "send_email":
        tracer.emit_state_mutation(
            run_id,
            session_id,
            tool_name,
            "create",
            "/email/sent",
            span_id,
        )
    elif tool_name == "calendar" and operation == "create_event":
        tracer.emit_state_mutation(
            run_id,
            session_id,
            tool_name,
            "create",
            "/calendar/events",
            span_id,
        )
    elif tool_name == "calendar" and operation == "delete_event":
        eid = args.get("event_id")
        tracer.emit_state_mutation(
            run_id,
            session_id,
            tool_name,
            "delete",
            f"/calendar/events/{eid}" if isinstance(eid, str) else "/calendar/events",
            span_id,
        )


app = create_app()


def main() -> None:
    """Run uvicorn (``python -m agent_eval_lab.tool_env.server``)."""
    port = int(os.environ.get("TOOL_ENV_PORT", "8002"))
    uvicorn.run(
        "agent_eval_lab.tool_env.server:app",
        host="0.0.0.0",
        port=port,
        log_level="info",
    )


if __name__ == "__main__":
    main()
