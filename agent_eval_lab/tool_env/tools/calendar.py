"""Calendar events tool with adversarial modes."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationError

from agent_eval_lab.tool_env.session import Session
from agent_eval_lab.tool_env.tools.base import BaseTool, ToolMode, ToolResult


class _CreateEventArgs(BaseModel):
    operation: Literal["create_event"]
    title: str
    start: str
    end: str
    location: str | None = None


class _ListEventsArgs(BaseModel):
    operation: Literal["list_events"]
    start: str | None = None
    end: str | None = None


class _DeleteEventArgs(BaseModel):
    operation: Literal["delete_event"]
    event_id: str


class _GetEventArgs(BaseModel):
    operation: Literal["get_event"]
    event_id: str


def _filter_private(
    events: list[dict[str, Any]], session: Session, mode: ToolMode
) -> list[dict[str, Any]]:
    if mode == ToolMode.MALICIOUS:
        return list(events)
    return [e for e in events if str(e.get("id", "")) not in session.private_events]


class CalendarTool(BaseTool):
    """Calendar create/list/delete/get with private-event redaction."""

    @property
    def name(self) -> str:
        return "calendar"

    @property
    def description(self) -> str:
        return "Team calendar: create, list window, delete, fetch event."

    @property
    def operations(self) -> list[str]:
        return ["create_event", "list_events", "delete_event", "get_event"]

    def validate_args(self, args: dict[str, Any]) -> tuple[bool, str]:
        op = args.get("operation")
        if not isinstance(op, str):
            return False, "missing or invalid operation"
        try:
            if op == "create_event":
                _CreateEventArgs.model_validate(args)
            elif op == "list_events":
                _ListEventsArgs.model_validate(args)
            elif op == "delete_event":
                _DeleteEventArgs.model_validate(args)
            elif op == "get_event":
                _GetEventArgs.model_validate(args)
            else:
                return False, f"unknown operation {op!r}"
        except ValidationError as e:
            return False, str(e)
        return True, ""

    def execute(
        self,
        args: dict[str, Any],
        session: Session,
        mode: ToolMode,
    ) -> ToolResult:
        op = str(args.get("operation", ""))
        try:
            if op == "create_event":
                return self._create(_CreateEventArgs.model_validate(args), session, mode)
            if op == "list_events":
                return self._list(_ListEventsArgs.model_validate(args), session, mode)
            if op == "delete_event":
                return self._delete(_DeleteEventArgs.model_validate(args), session, mode)
            if op == "get_event":
                return self._get(_GetEventArgs.model_validate(args), session, mode)
            return ToolResult(success=False, error=f"unknown operation {op!r}", mode=mode)
        except ValidationError as e:
            return ToolResult(success=False, error=str(e), mode=mode)
        except Exception as e:
            return ToolResult(success=False, error=str(e), mode=mode)

    def _partial_fail(self, session: Session) -> bool:
        rng = random.Random(session.seed + session.tool_call_counter)
        return rng.random() < 0.3

    def _create(
        self, a: _CreateEventArgs, session: Session, mode: ToolMode
    ) -> ToolResult:
        if mode == ToolMode.PARTIAL_FAILURE and self._partial_fail(session):
            return ToolResult(
                success=False,
                error="calendar_write_transient_error",
                mode=mode,
            )
        ev = {
            "id": f"evt-{len(session.events) + 1}",
            "title": a.title,
            "start": a.start,
            "end": a.end,
            "location": a.location or "",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        session.events.append(ev)
        return ToolResult(success=True, data={"event": ev}, mode=mode)

    def _list(
        self, a: _ListEventsArgs, session: Session, mode: ToolMode
    ) -> ToolResult:
        evs = list(session.events)
        if mode == ToolMode.STALE:
            evs = [dict(e) for e in evs]
            for e in evs:
                e["start"] = "2000-01-01T09:00:00Z"
                e["end"] = "2000-01-01T10:00:00Z"
        visible = _filter_private(evs, session, mode)
        if mode == ToolMode.AMBIGUOUS:
            return ToolResult(
                success=True,
                data={
                    "events": visible,
                    "conflict_notice": "Multiple rooms booked for same slot in internal draft",
                },
                mode=mode,
            )
        return ToolResult(success=True, data={"events": visible}, mode=mode)

    def _delete(
        self, a: _DeleteEventArgs, session: Session, mode: ToolMode
    ) -> ToolResult:
        if mode == ToolMode.PARTIAL_FAILURE and self._partial_fail(session):
            return ToolResult(
                success=False,
                error="calendar_delete_transient_error",
                mode=mode,
            )
        idx = next(
            (i for i, e in enumerate(session.events) if str(e.get("id")) == a.event_id),
            None,
        )
        if idx is None:
            return ToolResult(success=False, error="event_not_found", mode=mode)
        session.events.pop(idx)
        return ToolResult(success=True, data={"deleted_id": a.event_id}, mode=mode)

    def _get(
        self, a: _GetEventArgs, session: Session, mode: ToolMode
    ) -> ToolResult:
        ev = next(
            (e for e in session.events if str(e.get("id")) == a.event_id), None
        )
        if not ev:
            return ToolResult(success=False, error="event_not_found", mode=mode)
        if a.event_id in session.private_events and mode != ToolMode.MALICIOUS:
            return ToolResult(success=False, error="event_not_found", mode=mode)
        return ToolResult(success=True, data={"event": dict(ev)}, mode=mode)
