"""Permission rules and policy evaluation for tool calls."""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field

from agent_eval_lab.tool_env.session import Session


class PolicyDecision(str, Enum):
    """Outcome of a policy check."""

    ALLOW = "allow"
    DENY = "deny"
    AUDIT = "audit"


class PermissionRule(BaseModel):
    """Single ordered rule: first match wins (after protected-resource checks)."""

    tool: str = Field(description="Tool name or '*' for all tools")
    operation: str = Field(description="Operation name or '*'")
    decision: PolicyDecision
    reason: str = ""


class PolicyChecker:
    """
    Evaluates tool calls against a permission rule set.

    Rules are evaluated in order. First explicit rule match wins.
    Default policy: ALLOW (permissive; rules restrict selectively).

    Protected resources are enforced before rules, with an exception for
    :class:`~agent_eval_lab.tool_env.tools.base.ToolMode.MALICIOUS` session
    mode (simulated bypass / red-team scenarios).
    """

    def __init__(self, rules: list[PermissionRule]) -> None:
        self._rules = list(rules)

    def check(
        self,
        tool: str,
        operation: str,
        args: dict[str, Any],
        session: Session,
    ) -> tuple[PolicyDecision, str]:
        """
        Return ``(decision, reason)``.

        Checks protected resources first, then ordered rules, then ALLOW.
        """
        from agent_eval_lab.tool_env.tools.base import ToolMode

        malicious = session.mode == ToolMode.MALICIOUS

        protected = self._protected_resource_violation(
            tool, operation, args, session, allow_malicious_bypass=malicious
        )
        if protected is not None:
            return protected

        for rule in self._rules:
            if self._rule_matches(rule, tool, operation):
                return rule.decision, rule.reason or "rule_match"

        return PolicyDecision.ALLOW, "default_allow"

    def _rule_matches(self, rule: PermissionRule, tool: str, operation: str) -> bool:
        tool_ok = rule.tool == "*" or rule.tool == tool
        op_ok = rule.operation == "*" or rule.operation == operation
        return tool_ok and op_ok

    def _protected_resource_violation(
        self,
        tool: str,
        operation: str,
        args: dict[str, Any],
        session: Session,
        *,
        allow_malicious_bypass: bool,
    ) -> tuple[PolicyDecision, str] | None:
        """Return ``(DENY, reason)`` if access to a protected asset is denied."""
        if allow_malicious_bypass:
            return None

        path = args.get("path")
        if tool == "filesystem" and isinstance(path, str):
            normalized = path.replace("\\", "/")
            for p in session.protected_files:
                if normalized == p or normalized.startswith(p.rstrip("/") + "/"):
                    return PolicyDecision.DENY, "protected_file"

        email_id = args.get("email_id")
        if tool == "email" and operation == "get_email":
            if isinstance(email_id, str) and email_id in session.sensitive_emails:
                return PolicyDecision.DENY, "sensitive_email"

        event_id = args.get("event_id")
        if tool == "calendar" and operation == "get_event":
            if isinstance(event_id, str) and event_id in session.private_events:
                return PolicyDecision.DENY, "private_event"

        return None
