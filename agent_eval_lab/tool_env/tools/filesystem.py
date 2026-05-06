"""Virtual filesystem tool with adversarial modes."""

from __future__ import annotations

import random
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationError

from agent_eval_lab.tool_env.session import Session
from agent_eval_lab.tool_env.tools.base import BaseTool, ToolMode, ToolResult


def _norm_path(path: str) -> str:
    return path.replace("\\", "/").strip() or "/"


class _ReadFileArgs(BaseModel):
    operation: Literal["read_file"]
    path: str


class _WriteFileArgs(BaseModel):
    operation: Literal["write_file"]
    path: str
    content: str


class _ListDirArgs(BaseModel):
    operation: Literal["list_directory"]
    path: str = Field(default="/")


class _DeleteFileArgs(BaseModel):
    operation: Literal["delete_file"]
    path: str


class FilesystemTool(BaseTool):
    """Sandbox file read/write/list/delete with policy-sensitive paths."""

    @property
    def name(self) -> str:
        return "filesystem"

    @property
    def description(self) -> str:
        return "Virtual workspace filesystem (read, write, list, delete)."

    @property
    def operations(self) -> list[str]:
        return ["read_file", "write_file", "list_directory", "delete_file"]

    def validate_args(self, args: dict[str, Any]) -> tuple[bool, str]:
        op = args.get("operation")
        if not isinstance(op, str):
            return False, "missing or invalid operation"
        try:
            if op == "read_file":
                _ReadFileArgs.model_validate(args)
            elif op == "write_file":
                _WriteFileArgs.model_validate(args)
            elif op == "list_directory":
                _ListDirArgs.model_validate(args)
            elif op == "delete_file":
                _DeleteFileArgs.model_validate(args)
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
            if op == "read_file":
                return self._read_file(_ReadFileArgs.model_validate(args), session, mode)
            if op == "write_file":
                return self._write_file(
                    _WriteFileArgs.model_validate(args), session, mode
                )
            if op == "list_directory":
                return self._list_directory(
                    _ListDirArgs.model_validate(args), session, mode
                )
            if op == "delete_file":
                return self._delete_file(
                    _DeleteFileArgs.model_validate(args), session, mode
                )
            return ToolResult(success=False, error=f"unknown operation {op!r}", mode=mode)
        except ValidationError as e:
            return ToolResult(success=False, error=str(e), mode=mode)
        except Exception as e:
            return ToolResult(success=False, error=str(e), mode=mode)

    def _partial_fail(self, session: Session) -> bool:
        rng = random.Random(session.seed + session.tool_call_counter)
        return rng.random() < 0.3

    def _read_file(
        self, a: _ReadFileArgs, session: Session, mode: ToolMode
    ) -> ToolResult:
        if mode == ToolMode.PARTIAL_FAILURE and self._partial_fail(session):
            return ToolResult(
                success=False,
                error="transient_read_error: retry later",
                mode=mode,
            )
        path = _norm_path(a.path)
        content = session.files.get(path)
        if content is None:
            return ToolResult(success=False, error="file_not_found", mode=mode)
        out = content
        if mode == ToolMode.STALE:
            out = f"{content}\n[STALE]"
        data: dict[str, Any] = {"path": path, "content": out}
        if mode == ToolMode.AMBIGUOUS:
            data["metadata"] = [
                {"encoding": "utf-8", "verified": True},
                {"encoding": "utf-8", "verified": False},
            ]
        return ToolResult(success=True, data=data, mode=mode)

    def _write_file(
        self, a: _WriteFileArgs, session: Session, mode: ToolMode
    ) -> ToolResult:
        if mode == ToolMode.PARTIAL_FAILURE and self._partial_fail(session):
            return ToolResult(
                success=False,
                error="transient_write_error: retry later",
                mode=mode,
            )
        path = _norm_path(a.path)
        if path in session.protected_files and mode != ToolMode.MALICIOUS:
            return ToolResult(
                success=False,
                error="write_denied_protected_path",
                mode=mode,
            )
        session.files[path] = a.content
        return ToolResult(
            success=True,
            data={"path": path, "bytes_written": len(a.content.encode("utf-8"))},
            mode=mode,
        )

    def _list_directory(
        self, a: _ListDirArgs, session: Session, mode: ToolMode
    ) -> ToolResult:
        base = _norm_path(a.path).rstrip("/")
        names: set[str] = set()
        prefix = (base + "/") if base else ""
        for p in session.files:
            pn = _norm_path(p)
            if not base:
                seg = pn.strip("/").split("/")[0]
                if seg:
                    names.add(seg)
            elif pn.startswith(prefix):
                rest = pn[len(prefix) :]
                first = rest.split("/")[0]
                if first:
                    names.add(first)
        entries = sorted(names)
        if mode == ToolMode.STALE:
            return ToolResult(
                success=True,
                data={"path": a.path, "entries": entries, "note": "stale_listing"},
                mode=mode,
            )
        return ToolResult(
            success=True, data={"path": a.path, "entries": entries}, mode=mode
        )

    def _delete_file(
        self, a: _DeleteFileArgs, session: Session, mode: ToolMode
    ) -> ToolResult:
        if mode == ToolMode.PARTIAL_FAILURE and self._partial_fail(session):
            return ToolResult(
                success=False,
                error="transient_delete_error: retry later",
                mode=mode,
            )
        path = _norm_path(a.path)
        if path in session.protected_files and mode != ToolMode.MALICIOUS:
            return ToolResult(
                success=False,
                error="delete_denied_protected_path",
                mode=mode,
            )
        if path not in session.files:
            return ToolResult(success=False, error="file_not_found", mode=mode)
        del session.files[path]
        return ToolResult(success=True, data={"path": path, "deleted": True}, mode=mode)
