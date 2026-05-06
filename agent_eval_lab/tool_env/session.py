"""Session state and in-memory store with per-session asyncio locks."""

from __future__ import annotations

import asyncio
import copy
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, AsyncIterator

from pydantic import BaseModel, ConfigDict, Field

from agent_eval_lab.tool_env.tools.base import ToolMode


class Session(BaseModel):
    """Mutable evaluation sandbox (filesystem, email, calendar, search)."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    session_id: str
    seed: int = 0
    mode: ToolMode = ToolMode.BENIGN
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
    )
    tool_call_counter: int = 0

    files: dict[str, str] = Field(default_factory=dict)
    protected_files: set[str] = Field(default_factory=set)

    inbox: list[dict[str, Any]] = Field(default_factory=list)
    sent: list[dict[str, Any]] = Field(default_factory=list)
    sensitive_emails: list[str] = Field(default_factory=list)

    events: list[dict[str, Any]] = Field(default_factory=list)
    private_events: list[str] = Field(default_factory=list)

    search_index: dict[str, Any] = Field(default_factory=dict)
    poisoned_queries: list[str] = Field(default_factory=list)

    call_log: list[dict[str, Any]] = Field(default_factory=list)
    state_mutations: list[dict[str, Any]] = Field(default_factory=list)
    policy_decisions: list[dict[str, Any]] = Field(default_factory=list)

    policy_rules: list[dict[str, Any]] = Field(
        default_factory=list,
        description="YAML-serializable rules; converted to PermissionRule in server",
    )


class SessionStore:
    """
    In-memory session store with optional snapshot export.

    Thread-safe / task-safe via :class:`asyncio.Lock` per session id.
    """

    def __init__(self) -> None:
        self._sessions: dict[str, Session] = {}
        self._initial_snapshots: dict[str, dict[str, Any]] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._meta_lock = asyncio.Lock()

    async def _get_lock(self, session_id: str) -> asyncio.Lock:
        async with self._meta_lock:
            if session_id not in self._locks:
                self._locks[session_id] = asyncio.Lock()
            return self._locks[session_id]

    def _snapshot_dict(self, session: Session) -> dict[str, Any]:
        data = session.model_dump(mode="json")
        data["protected_files"] = list(session.protected_files)
        return copy.deepcopy(data)

    async def create(
        self,
        session_id: str | None = None,
        seed: int = 0,
        mode: ToolMode = ToolMode.BENIGN,
        fixture: dict[str, Any] | None = None,
    ) -> Session:
        """Create a new session; apply ``fixture`` fields when provided."""
        sid = session_id or str(uuid.uuid4())
        lock = await self._get_lock(sid)
        async with lock:
            base = Session(session_id=sid, seed=seed, mode=mode)
            if fixture:
                merged = _apply_fixture(base, fixture).model_copy(
                    update={"seed": seed, "mode": mode}
                )
            else:
                merged = base
            self._sessions[sid] = merged
            self._initial_snapshots[sid] = self._snapshot_dict(merged)
            return merged

    async def get(self, session_id: str) -> Session | None:
        lock = await self._get_lock(session_id)
        async with lock:
            s = self._sessions.get(session_id)
            return s.model_copy(deep=True) if s else None

    @asynccontextmanager
    async def lock_session(
        self, session_id: str
    ) -> AsyncIterator[Session | None]:
        """Hold the per-session lock and yield the live :class:`Session` or ``None``."""
        lock = await self._get_lock(session_id)
        async with lock:
            yield self._sessions.get(session_id)

    async def delete(self, session_id: str) -> None:
        lock = await self._get_lock(session_id)
        async with lock:
            self._sessions.pop(session_id, None)
            self._initial_snapshots.pop(session_id, None)

    async def snapshot(self, session_id: str) -> dict[str, Any]:
        lock = await self._get_lock(session_id)
        async with lock:
            s = self._sessions.get(session_id)
            if not s:
                return {}
            return self._snapshot_dict(s)

    async def restore(self, snapshot: dict[str, Any]) -> Session:
        """Restore a session from :meth:`snapshot` output."""
        sid = str(snapshot["session_id"])
        lock = await self._get_lock(sid)
        async with lock:
            session = _session_from_snapshot(snapshot)
            self._sessions[sid] = session
            return session.model_copy(deep=True)

    async def reset(self, session_id: str) -> Session | None:
        """Reset session to its initial fixture-backed state (same seed/mode)."""
        lock = await self._get_lock(session_id)
        async with lock:
            snap = self._initial_snapshots.get(session_id)
            if not snap:
                return None
            restored = _session_from_snapshot(copy.deepcopy(snap))
            self._sessions[session_id] = restored
            return restored.model_copy(deep=True)

    async def count(self) -> int:
        """Return number of active sessions."""
        async with self._meta_lock:
            return len(self._sessions)

def _apply_fixture(base: Session, fixture: dict[str, Any]) -> Session:
    """Merge fixture dict into a new Session instance."""
    raw = base.model_dump()
    for key in (
        "seed",
        "mode",
        "files",
        "inbox",
        "sent",
        "sensitive_emails",
        "events",
        "private_events",
        "search_index",
        "poisoned_queries",
        "policy_rules",
    ):
        if key in fixture and fixture[key] is not None:
            raw[key] = fixture[key]
    if "protected_files" in fixture and fixture["protected_files"] is not None:
        raw["protected_files"] = set(fixture["protected_files"])
    if "mode" in fixture and isinstance(fixture["mode"], str):
        raw["mode"] = ToolMode(fixture["mode"])
    raw["session_id"] = base.session_id
    raw["created_at"] = base.created_at
    raw["tool_call_counter"] = 0
    raw["call_log"] = []
    raw["state_mutations"] = []
    raw["policy_decisions"] = []
    return Session.model_validate(raw)


def _session_from_snapshot(snapshot: dict[str, Any]) -> Session:
    data = copy.deepcopy(snapshot)
    pf = data.get("protected_files")
    if isinstance(pf, list):
        data["protected_files"] = set(str(x) for x in pf)
    if isinstance(data.get("mode"), str):
        data["mode"] = ToolMode(data["mode"])
    return Session.model_validate(data)
