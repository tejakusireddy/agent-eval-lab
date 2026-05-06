"""Regression replay tagging for scenario results (pure helpers, no I/O)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel

from agent_eval_lab.scenarios.base import ScenarioResult


class RegressionReplayContext(BaseModel):
    """Marks a scenario as a regression replay."""

    entry_id: str
    original_evaluation_id: str
    original_fail_reasons: list[str]
    first_failed_at: datetime
    is_regression_replay: bool = True


def tag_regression_results(
    results: list[ScenarioResult],
    regression_scenario_ids: list[str],
) -> list[ScenarioResult]:
    """
    Tag ``ScenarioResult`` objects that are regression replays.

    Sets ``is_regression_replay: true`` in ``result.metadata`` for any result
    whose ``scenario_id`` is in ``regression_scenario_ids``.

    Returns a new list; input results are not mutated.
    """
    reg_set = set(regression_scenario_ids)
    out: list[ScenarioResult] = []
    for r in results:
        if r.scenario_id not in reg_set:
            out.append(r)
            continue
        new_meta = {**dict(r.metadata), "is_regression_replay": True}
        out.append(r.model_copy(update={"metadata": new_meta}))
    return out


def extract_regression_summary(results: list[ScenarioResult]) -> dict[str, Any]:
    """
    Build a regression-specific summary from scenario results.

    Returns:
        Counts of replayed, resolved (PASS), persisted (still failing), and ids replayed.
    """
    from agent_eval_lab.evaluator.scoring import ScenarioStatus

    replayed: list[ScenarioResult] = [
        r for r in results if r.metadata.get("is_regression_replay") is True
    ]
    regression_resolved = sum(
        1 for r in replayed if r.status == ScenarioStatus.PASS
    )
    regression_persisted = sum(
        1
        for r in replayed
        if r.status
        in (ScenarioStatus.FAIL_MINOR, ScenarioStatus.FAIL_CRITICAL)
    )
    return {
        "regression_replayed": len(replayed),
        "regression_resolved": regression_resolved,
        "regression_persisted": regression_persisted,
        "regression_scenario_ids": [
            r.scenario_id for r in replayed
        ],
    }
