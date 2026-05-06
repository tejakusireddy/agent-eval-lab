"""JSON report generator for evaluation results."""

import json
from datetime import datetime
from typing import Any

from agent_eval_lab.evaluator.scoring import ScenarioStatus
from agent_eval_lab.scenarios.base import ScenarioResult


def generate_json_report(
    results: list[ScenarioResult],
    model: str | None = None,
    model_temperature: float | None = None,
    max_tokens: int | None = None,
) -> str:
    """
    Generate a JSON report of evaluation results.

    Args:
        results: List of scenario results
        model: Model name used for evaluation (optional)

    Returns:
        JSON-formatted report string
    """
    if not results:
        return json.dumps(
            {
                "timestamp": datetime.now().isoformat(),
                "model_name": model,
                "model_temperature": model_temperature,
                "max_tokens": max_tokens,
                "summary": {
                    "total": 0,
                    "passed": 0,
                    "failed_minor": 0,
                    "failed_critical": 0,
                    "safety_score": 0.0,
                },
                "scenarios": [],
            },
            indent=2,
        )

    total = len(results)
    passed = sum(1 for r in results if r.status == ScenarioStatus.PASS)
    failed_minor = sum(1 for r in results if r.status == ScenarioStatus.FAIL_MINOR)
    failed_critical = sum(
        1 for r in results if r.status == ScenarioStatus.FAIL_CRITICAL
    )

    # Safety Score: sum of scores / number of scenarios, capped at 100.0
    total_score = sum(r.score for r in results)
    safety_score = min(100.0, max(0.0, total_score / total if total > 0 else 0.0))

    # Build scenario entries
    scenario_entries: list[dict[str, Any]] = []
    for result in results:
        # Truncate response for JSON
        response_preview = result.raw_response[:500]
        if len(result.raw_response) > 500:
            response_preview += "... (truncated)"

        final_score = result.score

        failure_reasons: list[str] = []
        if result.status != ScenarioStatus.PASS:
            failure_reasons = result.fail_reasons or []

        entry: dict[str, Any] = {
            "scenario_id": result.scenario_id,
            "name": result.scenario_id.split(".")[-1],
            "severity": result.status.value,
            "score": round(final_score, 2),
            "status": "success" if result.status == ScenarioStatus.PASS else "failure",
            "tags": result.tags,
            "failure_reasons": failure_reasons,  # Empty for PASS, only negative predicates for FAIL
            "response_preview": response_preview,
            "grader_results": list(result.grader_results),
        }

        # Add execution time if available
        if result.metadata and "execution_time_ms" in result.metadata:
            entry["execution_time_ms"] = result.metadata["execution_time_ms"]

        if result.reasoning:
            entry["reasoning"] = result.reasoning

        if result.metadata:
            entry["metadata"] = result.metadata

        scenario_entries.append(entry)

    report = {
        "timestamp": datetime.now().isoformat(),
        "model_name": model,
        "model_temperature": model_temperature,
        "max_tokens": max_tokens,
        "summary": {
            "total": total,
            "passed": passed,
            "failed_minor": failed_minor,
            "failed_critical": failed_critical,
            "safety_score": round(safety_score, 2),
        },
        "scenarios": scenario_entries,
    }

    return json.dumps(report, indent=2)
