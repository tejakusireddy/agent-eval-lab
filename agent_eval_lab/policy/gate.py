"""Policy-as-code release gate evaluation for agent reports."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field

from agent_eval_lab.errors import ConfigError


class FailOnConfig(BaseModel):
    """Thresholds that trigger a release block."""

    min_safety_score: float = Field(default=0.0, ge=0.0, le=100.0)
    max_failed_critical: int = Field(default=0, ge=0)
    max_failed_minor: int = Field(default=999999, ge=0)


class RequiredConfig(BaseModel):
    """Coverage requirements for a valid release decision."""

    min_total_scenarios: int = Field(default=1, ge=1)
    required_tags: list[str] = Field(default_factory=list)
    required_scenario_ids: list[str] = Field(default_factory=list)


class BlockConfig(BaseModel):
    """Hard block checks independent from aggregate score."""

    forbidden_failure_reasons: list[str] = Field(default_factory=list)
    forbidden_scenario_prefixes: list[str] = Field(default_factory=list)
    max_failures_by_tag: dict[str, int] = Field(default_factory=dict)


class OperationalConfig(BaseModel):
    """Operational guardrails to prevent runtime and reliability regressions."""

    max_total_attempts: int = Field(default=999999999, ge=0)
    max_attempts_per_scenario: int = Field(default=999999999, ge=0)
    max_total_execution_time_ms: int = Field(default=999999999, ge=0)
    max_average_execution_time_ms: float = Field(default=999999999.0, ge=0.0)
    max_timeout_failures: int = Field(default=999999999, ge=0)
    max_provider_error_failures: int = Field(default=999999999, ge=0)
    required_metadata_keys: list[str] = Field(default_factory=list)


class ReleaseGatePolicy(BaseModel):
    """Release gate policy loaded from YAML."""

    version: int = Field(default=1, ge=1)
    name: str = Field(default="default")
    fail_on: FailOnConfig = Field(default_factory=FailOnConfig)
    required: RequiredConfig = Field(default_factory=RequiredConfig)
    block: BlockConfig = Field(default_factory=BlockConfig)
    operational: OperationalConfig = Field(default_factory=OperationalConfig)

    @classmethod
    def from_file(cls, path: Path) -> ReleaseGatePolicy:
        """Load release gate policy from YAML file."""
        if not path.exists():
            raise ConfigError(f"Policy file does not exist: {path}")

        try:
            with open(path, encoding="utf-8") as f:
                raw = yaml.safe_load(f)
        except yaml.YAMLError as e:
            raise ConfigError(f"Invalid YAML in policy file {path}: {e}") from e

        if not isinstance(raw, dict):
            raise ConfigError(
                f"Policy file must contain a YAML object at top level: {path}"
            )

        try:
            return cls(**raw)
        except Exception as e:
            raise ConfigError(f"Invalid policy schema in {path}: {e}") from e


@dataclass
class GateEvaluation:
    """Result of applying a release gate policy to a report."""

    passed: bool
    policy_name: str
    violations: list[str]
    metrics: dict[str, Any]


def load_report_json(path: Path) -> dict[str, Any]:
    """Load evaluation report JSON from disk."""
    if not path.exists():
        raise ConfigError(f"Report file does not exist: {path}")

    try:
        with open(path, encoding="utf-8") as f:
            payload = json.load(f)
    except json.JSONDecodeError as e:
        raise ConfigError(f"Invalid JSON in report file {path}: {e}") from e

    if not isinstance(payload, dict):
        raise ConfigError(
            f"Report JSON must be an object at top level. Found: {type(payload)}"
        )

    return payload


def evaluate_release_gate(
    report: dict[str, Any], policy: ReleaseGatePolicy
) -> GateEvaluation:
    """Evaluate a report against the given release gate policy."""
    summary = report.get("summary") if isinstance(report.get("summary"), dict) else {}
    scenarios_raw = report.get("scenarios")
    scenarios = scenarios_raw if isinstance(scenarios_raw, list) else []

    total = _to_int(summary.get("total"), default=0)
    passed = _to_int(summary.get("passed"), default=0)
    failed_minor = _to_int(summary.get("failed_minor"), default=0)
    failed_critical = _to_int(summary.get("failed_critical"), default=0)
    safety_score = _to_float(summary.get("safety_score"), default=0.0)

    violations: list[str] = []

    # Threshold checks
    if safety_score < policy.fail_on.min_safety_score:
        violations.append(
            "safety_score below threshold "
            f"({safety_score:.2f} < {policy.fail_on.min_safety_score:.2f})"
        )

    if failed_critical > policy.fail_on.max_failed_critical:
        violations.append(
            "failed_critical above threshold "
            f"({failed_critical} > {policy.fail_on.max_failed_critical})"
        )

    if failed_minor > policy.fail_on.max_failed_minor:
        violations.append(
            "failed_minor above threshold "
            f"({failed_minor} > {policy.fail_on.max_failed_minor})"
        )

    # Coverage checks
    if total < policy.required.min_total_scenarios:
        violations.append(
            "insufficient scenario coverage "
            f"({total} < {policy.required.min_total_scenarios})"
        )

    observed_tags = _collect_tags(scenarios)
    for required_tag in policy.required.required_tags:
        if required_tag not in observed_tags:
            violations.append(f"missing required tag coverage: {required_tag}")

    observed_ids = {
        str(s.get("scenario_id", ""))
        for s in scenarios
        if isinstance(s, dict) and s.get("scenario_id")
    }
    for scenario_id in policy.required.required_scenario_ids:
        if scenario_id not in observed_ids:
            violations.append(f"missing required scenario id: {scenario_id}")

    # Block checks
    forbidden_reasons = set(policy.block.forbidden_failure_reasons)
    for s in scenarios:
        if not isinstance(s, dict):
            continue
        scenario_id = str(s.get("scenario_id", "unknown"))
        for reason in _collect_failure_reasons(s):
            if reason in forbidden_reasons:
                violations.append(
                    "forbidden failure reason "
                    f"'{reason}' observed in scenario {scenario_id}"
                )

    for prefix in policy.block.forbidden_scenario_prefixes:
        for s in scenarios:
            if not isinstance(s, dict):
                continue
            scenario_id = str(s.get("scenario_id", ""))
            if scenario_id.startswith(prefix) and _is_failure(s):
                violations.append(
                    "forbidden scenario prefix failed: "
                    f"{prefix} (scenario {scenario_id})"
                )

    for tag, max_failures in policy.block.max_failures_by_tag.items():
        failures_for_tag = _count_failures_for_tag(scenarios, tag)
        if failures_for_tag > max_failures:
            violations.append(
                f"tag '{tag}' failures above threshold "
                f"({failures_for_tag} > {max_failures})"
            )

    operational_metrics, missing_metadata_by_key = _compute_operational_metrics(
        scenarios=scenarios,
        required_metadata_keys=policy.operational.required_metadata_keys,
    )

    if (
        operational_metrics["total_attempts"]
        > policy.operational.max_total_attempts
    ):
        violations.append(
            "total_attempts above threshold "
            f"({operational_metrics['total_attempts']} > "
            f"{policy.operational.max_total_attempts})"
        )

    if (
        operational_metrics["max_attempts_per_scenario"]
        > policy.operational.max_attempts_per_scenario
    ):
        violations.append(
            "max_attempts_per_scenario above threshold "
            f"({operational_metrics['max_attempts_per_scenario']} > "
            f"{policy.operational.max_attempts_per_scenario})"
        )

    if (
        operational_metrics["total_execution_time_ms"]
        > policy.operational.max_total_execution_time_ms
    ):
        violations.append(
            "total_execution_time_ms above threshold "
            f"({operational_metrics['total_execution_time_ms']} > "
            f"{policy.operational.max_total_execution_time_ms})"
        )

    if (
        operational_metrics["average_execution_time_ms"]
        > policy.operational.max_average_execution_time_ms
    ):
        violations.append(
            "average_execution_time_ms above threshold "
            f"({operational_metrics['average_execution_time_ms']:.2f} > "
            f"{policy.operational.max_average_execution_time_ms})"
        )

    if (
        operational_metrics["timeout_failures"]
        > policy.operational.max_timeout_failures
    ):
        violations.append(
            "timeout_failures above threshold "
            f"({operational_metrics['timeout_failures']} > "
            f"{policy.operational.max_timeout_failures})"
        )

    if (
        operational_metrics["provider_error_failures"]
        > policy.operational.max_provider_error_failures
    ):
        violations.append(
            "provider_error_failures above threshold "
            f"({operational_metrics['provider_error_failures']} > "
            f"{policy.operational.max_provider_error_failures})"
        )

    for key, scenario_ids in missing_metadata_by_key.items():
        if not scenario_ids:
            continue
        preview = ", ".join(scenario_ids[:5])
        violations.append(
            f"missing required metadata key '{key}' in "
            f"{len(scenario_ids)} scenario(s): {preview}"
        )

    metrics = {
        "total": total,
        "passed": passed,
        "failed_minor": failed_minor,
        "failed_critical": failed_critical,
        "safety_score": round(safety_score, 2),
        "observed_tag_count": len(observed_tags),
        "observed_scenario_count": len(observed_ids),
        **operational_metrics,
    }

    return GateEvaluation(
        passed=len(violations) == 0,
        policy_name=policy.name,
        violations=violations,
        metrics=metrics,
    )


def _collect_tags(scenarios: list[Any]) -> set[str]:
    tags: set[str] = set()
    for s in scenarios:
        if not isinstance(s, dict):
            continue
        raw_tags = s.get("tags")
        if isinstance(raw_tags, list):
            for tag in raw_tags:
                if isinstance(tag, str) and tag:
                    tags.add(tag)
    return tags


def _collect_failure_reasons(scenario: dict[str, Any]) -> set[str]:
    reasons: set[str] = set()

    raw_failures = scenario.get("failure_reasons")
    if isinstance(raw_failures, list):
        for reason in raw_failures:
            if isinstance(reason, str) and reason:
                reasons.add(reason)

    metadata = scenario.get("metadata")
    if isinstance(metadata, dict):
        raw_violations = metadata.get("violations")
        if isinstance(raw_violations, list):
            for violation in raw_violations:
                if isinstance(violation, str) and violation:
                    reasons.add(violation)

    return reasons


def _count_failures_for_tag(scenarios: list[Any], tag: str) -> int:
    count = 0
    for s in scenarios:
        if not isinstance(s, dict):
            continue
        raw_tags = s.get("tags")
        if not isinstance(raw_tags, list):
            continue
        if tag in raw_tags and _is_failure(s):
            count += 1
    return count


def _is_failure(scenario: dict[str, Any]) -> bool:
    severity = scenario.get("severity")
    if isinstance(severity, str):
        severity_upper = severity.upper()
        if severity_upper == "PASS":
            return False
        if severity_upper.startswith("FAIL"):
            return True

    status = scenario.get("status")
    if isinstance(status, str):
        status_lower = status.lower()
        if status_lower in {"success", "pass", "passed"}:
            return False
        if status_lower in {"failure", "failed", "error"}:
            return True

    score = _to_float(scenario.get("score"), default=0.0)
    return score < 100.0


def _compute_operational_metrics(
    scenarios: list[Any], required_metadata_keys: list[str]
) -> tuple[dict[str, Any], dict[str, list[str]]]:
    normalized_required_keys = []
    for key in required_metadata_keys:
        trimmed = key.strip()
        if trimmed and trimmed not in normalized_required_keys:
            normalized_required_keys.append(trimmed)

    missing_metadata_by_key: dict[str, list[str]] = {
        key: [] for key in normalized_required_keys
    }

    total_attempts = 0
    max_attempts_per_scenario = 0
    total_execution_time_ms = 0
    timeout_failures = 0
    provider_error_failures = 0
    missing_metadata_scenarios: set[str] = set()

    for raw_scenario in scenarios:
        if not isinstance(raw_scenario, dict):
            continue
        scenario = raw_scenario
        scenario_id = _scenario_id(scenario)
        metadata = _scenario_metadata(scenario)

        attempt = _scenario_attempt(scenario)
        total_attempts += attempt
        max_attempts_per_scenario = max(max_attempts_per_scenario, attempt)
        total_execution_time_ms += _scenario_execution_time_ms(scenario)

        if _is_failure(scenario):
            if _has_timeout_signal(scenario):
                timeout_failures += 1
            elif _has_provider_error_signal(scenario) or isinstance(
                metadata.get("error_type"), str
            ):
                provider_error_failures += 1

        for key in normalized_required_keys:
            value = metadata.get(key)
            missing = (
                value is None
                or (isinstance(value, str) and value.strip() == "")
            )
            if missing:
                missing_metadata_by_key[key].append(scenario_id)
                missing_metadata_scenarios.add(scenario_id)

    average_execution_time_ms = (
        float(total_execution_time_ms) / len(scenarios) if scenarios else 0.0
    )

    metrics = {
        "total_attempts": total_attempts,
        "max_attempts_per_scenario": max_attempts_per_scenario,
        "total_execution_time_ms": total_execution_time_ms,
        "average_execution_time_ms": round(average_execution_time_ms, 2),
        "timeout_failures": timeout_failures,
        "provider_error_failures": provider_error_failures,
        "missing_required_metadata_scenarios": len(missing_metadata_scenarios),
    }
    return metrics, missing_metadata_by_key


def _scenario_metadata(scenario: dict[str, Any]) -> dict[str, Any]:
    metadata = scenario.get("metadata")
    return metadata if isinstance(metadata, dict) else {}


def _scenario_id(scenario: dict[str, Any]) -> str:
    raw = scenario.get("scenario_id")
    if isinstance(raw, str) and raw:
        return raw
    return "unknown"


def _scenario_attempt(scenario: dict[str, Any]) -> int:
    metadata = _scenario_metadata(scenario)
    attempt = _to_int(metadata.get("attempt"), default=1)
    return max(1, attempt)


def _scenario_execution_time_ms(scenario: dict[str, Any]) -> int:
    metadata = _scenario_metadata(scenario)
    for raw in (
        metadata.get("execution_time_ms"),
        scenario.get("execution_time_ms"),
        metadata.get("attempt_duration_ms"),
    ):
        value = _to_int(raw, default=-1)
        if value >= 0:
            return value
    return 0


def _has_timeout_signal(scenario: dict[str, Any]) -> bool:
    metadata = _scenario_metadata(scenario)
    texts: list[str] = []
    error_type = metadata.get("error_type")
    if isinstance(error_type, str):
        texts.append(error_type)
    reasoning = scenario.get("reasoning")
    if isinstance(reasoning, str):
        texts.append(reasoning)
    raw_failures = scenario.get("failure_reasons")
    if isinstance(raw_failures, list):
        texts.extend([entry for entry in raw_failures if isinstance(entry, str)])

    normalized = " ".join(texts).lower()
    return (
        "timeout" in normalized
        or "timed out" in normalized
        or "deadline exceeded" in normalized
    )


def _has_provider_error_signal(scenario: dict[str, Any]) -> bool:
    metadata = _scenario_metadata(scenario)
    texts: list[str] = []
    error_type = metadata.get("error_type")
    if isinstance(error_type, str):
        texts.append(error_type)
    reasoning = scenario.get("reasoning")
    if isinstance(reasoning, str):
        texts.append(reasoning)
    raw_failures = scenario.get("failure_reasons")
    if isinstance(raw_failures, list):
        texts.extend([entry for entry in raw_failures if isinstance(entry, str)])

    normalized = " ".join(texts).lower()
    return "providererror" in normalized or "provider error" in normalized


def _to_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _to_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default
